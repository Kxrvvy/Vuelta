/**
 * The driver for M1's state layer.
 *
 * Everything with rules in it lives in `core/`: the clock, the reconciler, the
 * optimistic overrides, the poll cadence. None of that can run itself, because
 * `core/` has no DOM and therefore no `requestAnimationFrame` and no
 * `setTimeout`. This file supplies the two things it is missing — a frame loop
 * and a timer — and the bridge to talk to Spotify through.
 *
 * It is also where `RenderState` is assembled. That assembly happens on every
 * frame into a *ref*, never into React state: CLAUDE.md forbids animating
 * through React, and `progressMs` changes sixty times a second. A separate,
 * deliberately slow readout drives the panel's text.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { armAngleNow } from '../core/armMath.js'
import type {
  Actions,
  PlaylistTrack,
  PlayerPoll,
  RenderState,
  TrackSummary,
  LaunchSpotifyResult,} from '../core/contract.js'
import { INITIAL_RENDER_STATE, PLATTER_RPM } from '../core/contract.js'
import type { Engine } from '../core/engine.js'
import { createEngine } from '../core/engine.js'
import type { PlaybackPort } from '../core/ports.js'
import type { VueltaStore } from '../core/store.js'
import { isPollFailure, nextPollDelay } from '../core/syncPolicy.js'
import { IDLE_TRANSITION, stepTransition, type Transition } from '../core/transition.js'

/** Panel text refresh. The scene reads the ref at 60fps; text needs 4Hz. */
const READOUT_HZ = 4

/**
 * How long a skip's optimistic cover outlives the command.
 *
 * Long enough to cover the poll's own interval -- it answers every 3-5s and
 * the command has to reach Spotify first -- and short enough that a skip which
 * never took effect gives the display back rather than stranding it on a track
 * that is not playing.
 */
const DISPLAY_OVERRIDE_MS = 6000

/**
 * How long a lid closed by hand stays closed.
 *
 * Closing is the stop gesture, so it pauses -- and normally that settles it,
 * because a paused deck has no music for the lid to answer to. But the pause
 * has to reach Spotify and the poll has to agree, and if the music is really
 * coming from another device it never will. Without this the lid springs back
 * open under the hand that just shut it. Long enough for the command to land
 * and the poll to catch up; short enough that it is not a mode.
 */
const LID_HELD_SHUT_MS = 5000

/**
 * The launch sequence's two pauses.
 *
 * `LID_SETTLE_MS` is how long the music waits for the lid. The lid is damped
 * rather than timed -- it eases toward open at lambda 3.2 -- so there is no
 * duration to read off it; this is where it looks open. Only the automatic
 * launch pays it. Pressing play by hand is never held back.
 *
 * `STAGE_SETTLE_MS` is the beat before that, and it is long because it is not
 * waiting for React -- it is waiting for the scene to be *drawn*. Arming the
 * device ends the no-device state, which mounts the canvas from nothing:
 * shaders compile, the environment map is generated, textures load. For a good
 * fraction of a second the window shows the backdrop and no machine at all.
 *
 * Measured across three cold mounts, the machine is not visibly drawn until
 * about 1.0-1.2s in (1222ms, 1044ms, 1039ms). At 300ms the whole beat was
 * spent inside that blank period: the lid began rising some 800ms before
 * anything was on screen, so the deck first appeared with its lid already
 * most of the way up and the closed pose was never seen -- which is the one
 * thing this sequence exists to show.
 *
 * 2000 leaves roughly 900ms of visibly shut deck after it paints, which is
 * long enough to read as shut rather than as a frame that flickered past.
 */
const LID_SETTLE_MS = 1100
const STAGE_SETTLE_MS = 2000

/** The port, backed by the preload bridge. This is the only place they meet. */
function bridgePort(): PlaybackPort {
  return {
    getPlayer: () => window.vuelta.getPlayer(),
    play: () => window.vuelta.play(),
    pause: () => window.vuelta.pause(),
    seek: (ms) => window.vuelta.seek(ms),
    next: () => window.vuelta.next(),
    previous: () => window.vuelta.previous(),
    setVolume: (percent) => window.vuelta.setVolume(percent),
  }
}

export type Readout = {
  progressMs: number
  durationMs: number
  isPlaying: boolean
  volumePercent: number | null
  deviceName: string | null
  /** The playlist or album in play, so the browser bar can act on it. */
  contextUri: string | null
  /**
   * Surfaced so the view can refuse to move the camera mid-drag. The scene
   * re-frames when the panel hides, and sliding the arm's geometry out from
   * under a cursor that is still holding it would be a nasty surprise.
   */
  isDragging: boolean
}

/**
 * The track the scene should be *drawing*, which is not always the track that
 * is playing.
 *
 * For the hidden moment in the middle of a record swap it is the incoming one:
 * the art and the label change while the disc is behind the sleeve, which is
 * two seconds before Spotify agrees the track has changed. Resolving it here
 * means the skin never has to know which side of the boundary it is on.
 */
export type Display = {
  albumArtUrl: string | null
  title: string | null
  artist: string | null
}

/**
 * Where the launch sequence has got to, for the screen that shows it.
 *
 * `outcome` is null until there is something to say. An `armed` outcome at
 * the end means the whole sequence ran: Spotify came up, the lid opened and
 * the music started.
 */
export type LaunchState = {
  phase: 'idle' | 'running' | 'done'
  outcome: LaunchSpotifyResult | null
}

export type Sync = {
  launch: LaunchState
  runLaunch: () => Promise<void>
  /** Live state for the skin. Mutated in place; never triggers a render. */
  stateRef: React.RefObject<RenderState>
  actions: Actions
  /** Structural — changes rarely, so it is real React state. */
  track: TrackSummary | null
  /** What to draw, which leads `track` by the length of a swap. */
  display: Display
  /** Slow text values for the panel. */
  readout: Readout
  /** True while anything is moving, so the scene can drop to on-demand. */
  active: boolean
  lidOpen: boolean
  openLid: () => void
  closeLid: () => void
  beginArmDrag: () => void
  dragToProgress: (ms: number) => void
  endArmDrag: () => void
  /** Poll immediately, for the NO_DEVICE screen's "check again". */
  pollNow: () => Promise<void>
  engine: Engine
}

export function useSync(store: VueltaStore, enabled: boolean): Sync {
  const engine = useMemo(() => createEngine({ port: bridgePort() }), [])

  const stateRef = useRef<RenderState>({ ...INITIAL_RENDER_STATE })
  const lidOpenRef = useRef(false)
  /**
   * When the user last shut the lid themselves, on the frame loop's own clock
   * (`performance.now()`). See `LID_HELD_SHUT_MS`.
   */
  const closedByHandAt = useRef(Number.NEGATIVE_INFINITY)

  // M6. The transition is stepped every frame, so it lives in a ref; the
  // pre-fetched next track does too, because the frame loop reads it and must
  // not be re-created when it arrives.
  const transitionRef = useRef<Transition>(IDLE_TRANSITION)
  const nextTrackRef = useRef<PlaylistTrack | null>(null)

  const [lidOpen, setLidOpen] = useState(false)
  const [track, setTrack] = useState<TrackSummary | null>(null)
  const [display, setDisplay] = useState<Display>({
    albumArtUrl: null,
    title: null,
    artist: null,
  })
  const displayRef = useRef<Display>(display)
  /**
   * What a skip has asked the scene to draw before the poll agrees, and the
   * track it was skipping away from -- the poll moving off that id is how we
   * know it has caught up.
   */
  const displayOverrideRef = useRef<{
    shows: Display
    fromTrackId: string | null
    until: number
  } | null>(null)
  /** The last track the poll reported, read by the override above. */
  const polledTrackIdRef = useRef<string | null>(null)
  const [active, setActive] = useState(false)
  const [readout, setReadout] = useState<Readout>({
    progressMs: 0,
    durationMs: 0,
    isPlaying: false,
    volumePercent: null,
    deviceName: null,
    contextUri: null,
    isDragging: false,
  })

  // ---- the frame loop ------------------------------------------------------
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let lastReadout = 0
    let lastTrackId: string | null = null
    let lastPlaying: boolean | null = null
    /** Per-frame, unlike `lastTrackId`, which only moves at READOUT_HZ. */
    let lastSwapTrackId: string | null = null

    const frame = (now: number) => {
      const delta = now - last
      last = now

      engine.tick(delta, Date.now())
      const value = engine.read(Date.now())

      // Assemble RenderState in place. No setState anywhere in this function.
      const state = stateRef.current
      state.progressMs = value.progressMs
      state.durationMs = value.durationMs
      state.isPlaying = value.isPlaying
      state.isDragging = value.isDragging
      state.albumArtUrl = value.track?.albumArtUrl ?? null
      state.lidOpen = lidOpenRef.current
      state.platterRpm = value.isPlaying ? PLATTER_RPM : 0
      // Every rule about where the arm rests lives in core/armMath.ts, so it
      // can be stepped in a test rather than read out of this assembly.
      state.armAngle = armAngleNow({
        lidOpen: lidOpenRef.current,
        isPlaying: value.isPlaying,
        isDragging: value.isDragging,
        progressMs: value.progressMs,
        durationMs: value.durationMs,
      })

      // ---- the record swap, M6 ---------------------------------------------
      // Anticipated: `stepTransition` arms on the *local clock* reading about
      // two seconds left, not on a poll reporting a change that has already
      // been heard. The queue pre-fetch is what makes that possible.
      const swapTrackId = value.track?.trackId ?? null
      const trackChanged = swapTrackId !== lastSwapTrackId
      lastSwapTrackId = swapTrackId

      const nextUp = nextTrackRef.current
      transitionRef.current = stepTransition(transitionRef.current, {
        deltaMs: delta,
        remainingMs: value.durationMs - value.progressMs,
        durationMs: value.durationMs,
        trackChanged,
        hasNext: nextUp !== null,
        isPlaying: value.isPlaying,
      })

      const transition = transitionRef.current
      state.transitionPhase = transition.phase
      state.transitionOut = transition.out
      state.nextAlbumArtUrl = nextUp?.albumArtUrl ?? null

      // The one React write in this loop that is not throttled, because it
      // happens once per swap rather than once per frame: which track the
      // scene is drawing.
      // What the scene is drawing. Normally the polled track, or the queued
      // one while the M6 swap is mid-flight.
      // A closed lid over a turning record is the app contradicting itself, so
      // the lid answers the music. Only this direction is new: opening still
      // plays nothing, and closing is still the stop gesture.
      //
      // It runs for the whole session rather than once at startup, because
      // "the record is already playing" is true whenever it is true -- the
      // music can start from the Spotify client at any point, not just before
      // Vuelta opens.
      if (
        value.isPlaying &&
        !lidOpenRef.current &&
        now - closedByHandAt.current > LID_HELD_SHUT_MS
      ) {
        setLid(true)
      }

      const shown = transition.showNext && nextUp ? nextUp : value.track

      // A skip writes an optimistic override, the same discipline the clock
      // uses: the poll is up to five seconds behind a command, and without
      // this the frame after the skip reads the *old* track back out of it and
      // puts the old cover straight back up. Measured, that showed as the new
      // cover appearing, reverting, and arriving again a second later.
      //
      // It lives until the poll reports some other track -- which is the poll
      // catching up, whether or not it agrees with the guess -- or until it
      // times out, so a skip that silently failed cannot strand the display.
      let override = displayOverrideRef.current
      if (override) {
        const polled = value.track?.trackId ?? null
        if (now > override.until || (polled !== null && polled !== override.fromTrackId)) {
          displayOverrideRef.current = null
          override = null
        }
      }
      polledTrackIdRef.current = value.track?.trackId ?? null
      const shownArt = override ? override.shows.albumArtUrl : (shown?.albumArtUrl ?? null)
      const shownTitle = override ? override.shows.title : (shown?.title ?? null)
      const shownArtist = override ? override.shows.artist : (shown?.artist ?? null)
      const drawn = displayRef.current
      if (
        shownArt !== drawn.albumArtUrl ||
        shownTitle !== drawn.title ||
        shownArtist !== drawn.artist
      ) {
        displayRef.current = { albumArtUrl: shownArt, title: shownTitle, artist: shownArtist }
        setDisplay(displayRef.current)
      }

      if (now - lastReadout > 1000 / READOUT_HZ) {
        lastReadout = now
        setReadout({
          progressMs: value.progressMs,
          durationMs: value.durationMs,
          isPlaying: value.isPlaying,
          volumePercent: value.volumePercent,
          deviceName: value.deviceName,
          contextUri: value.contextUri,
          isDragging: value.isDragging,
        })
        setActive(value.isPlaying || value.isDragging || state.platterRpm > 0)

        const id = value.track?.trackId ?? null
        if (id !== lastTrackId) {
          lastTrackId = id
          setTrack(value.track)
        }

        // Keep the phase following the engine, so an optimistic play or pause
        // shows in the status line at once instead of waiting for a poll to
        // agree. Dispatched only on a real change — POLL_OK builds a new state
        // object every time, and doing that four times a second would re-render
        // the app for nothing.
        if (value.isPlaying !== lastPlaying) {
          lastPlaying = value.isPlaying
          store.getState().dispatch({ type: 'POLL_OK', isPlaying: value.isPlaying })
        }
      }

      raf = requestAnimationFrame(frame)
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [engine, store])

  // ---- the poll loop -------------------------------------------------------
  useEffect(() => {
    if (!enabled) return

    let timer: number | undefined
    let cancelled = false
    let failures = 0

    const schedule = (delay: number) => {
      if (cancelled) return
      timer = window.setTimeout(run, delay)
    }

    const run = async () => {
      if (cancelled) return

      // Nothing to learn while the window is hidden, and polling anyway burns
      // the rate limit for a screen nobody is looking at.
      if (document.hidden) {
        schedule(2000)
        return
      }

      let poll: PlayerPoll
      try {
        poll = await window.vuelta.getPlayer()
      } catch (cause) {
        poll = {
          kind: 'error',
          code: 'unknown',
          message: cause instanceof Error ? cause.message : String(cause),
        }
      }
      if (cancelled) return

      const outcome = engine.applyPoll(poll, Date.now())

      // The phase machine is fed from the *engine*, not from the raw poll.
      // Feeding it the poll directly gave two sources of truth for isPlaying:
      // the engine honoured an optimistic override while the phase did not, so
      // the status line contradicted the transport button for a few seconds
      // after every play or pause.
      const { dispatch } = store.getState()
      if (poll.kind === 'no-device') dispatch({ type: 'POLL_NO_DEVICE' })
      else if (poll.kind === 'error') {
        dispatch({ type: 'POLL_FAILED', code: poll.code, message: poll.message })
      } else {
        dispatch({ type: 'POLL_OK', isPlaying: engine.read(Date.now()).isPlaying })
      }

      failures = isPollFailure(poll.kind) ? failures + 1 : 0

      schedule(
        nextPollDelay({
          isPlaying: engine.read(Date.now()).isPlaying,
          retryAfterMs: outcome.retryAfterMs,
          consecutiveFailures: failures,
          jitter: Math.random(),
        }),
      )
    }

    void run()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [enabled, engine, store])

  // ---- the queue pre-fetch (M6) --------------------------------------------
  // One read per track, so a swap can begin before the boundary rather than
  // after a poll reports it. Deliberately not joined to the player poll: the
  // next track changes once every few minutes, and spending a request on it
  // every three seconds would burn a rate limit shared with everything else.
  //
  // `GET /me/player/queue` needs no scope beyond `user-read-playback-state`.
  useEffect(() => {
    const trackId = track?.trackId ?? null
    if (!enabled || !trackId) {
      nextTrackRef.current = null
      return
    }

    let cancelled = false
    void (async () => {
      let result
      try {
        result = await window.vuelta.getQueue()
      } catch {
        // A failed pre-fetch is not an error worth showing: it only means the
        // next boundary animates as a load rather than as a swap.
        return
      }
      if (cancelled) return
      nextTrackRef.current = result.ok ? (result.queue.items[0] ?? null) : null
    })()

    return () => {
      cancelled = true
    }
  }, [enabled, track?.trackId])

  // ---- the lid -------------------------------------------------------------
  // Two one-way controls rather than a toggle. The Open button releases the
  // latch; clicking the acrylic shuts it. Each is a no-op in the state where
  // it has nothing to do, so neither can undo the other by accident.
  const setLid = useCallback(
    (open: boolean) => {
      if (lidOpenRef.current === open) return
      lidOpenRef.current = open
      setLidOpen(open)
      // Stamped on the way down, so the automatic open below can tell a lid
      // the user just shut from one that was never opened.
      //
      // `performance.now()`, not `Date.now()`: the frame loop compares this
      // against the rAF timestamp, which counts from page load, and epoch
      // milliseconds against it gives a difference of about -1.8e12. That is
      // never greater than the grace, so the lid could never reopen -- and at
      // startup it put the first automatic open five seconds late, because
      // the rAF clock had to climb past the window from zero.
      if (!open) closedByHandAt.current = performance.now()
      // Asymmetric on purpose, not a missing branch. Opening is mechanical:
      // the lid rises and the machine waits, because a lid does not start a
      // record — clicking the disc does. Closing is the stop gesture (spec
      // §11), so it pauses and sends the arm back to the cradle.
      if (!open) engine.actions.pause()
    },
    [engine],
  )

  const openLid = useCallback(() => setLid(true), [setLid])
  const closeLid = useCallback(() => setLid(false), [setLid])

  const pollNow = useCallback(async () => {
    const poll = await window.vuelta.getPlayer()
    store.getState().applyPoll(poll)
    engine.applyPoll(poll, Date.now())
  }, [engine, store])

  /**
   * Skip, without waiting for the poll to notice.
   *
   * `display` follows `value.track`, which only moves when `GET /me/player`
   * answers -- measured at about 1.6s after a skip, and up to the poll's full
   * 3-5s interval at worst. The music has already changed by then, so the
   * cover and the field behind it sit on the old track for a beat.
   *
   * Two halves to the fix. The queue's head is already pre-fetched for the M6
   * swap, so on `next` the right cover is in hand before the command is even
   * sent and can be drawn at once; and either way the poll is asked again
   * shortly after, rather than on its own schedule. `previous` has nothing
   * pre-fetched -- the queue only looks forward -- so it gets the re-poll
   * alone.
   */
  const repoll = useCallback(() => {
    // Spotify needs a moment to apply the command before it reports it. Two
    // goes, because one at 300ms is sometimes still the old track.
    window.setTimeout(() => void pollNow(), 300)
    window.setTimeout(() => void pollNow(), 900)
  }, [pollNow])

  const actions = useMemo<Actions>(
    () => ({
      ...engine.actions,
      next: () => {
        const queued = nextTrackRef.current
        if (queued) {
          displayOverrideRef.current = {
            shows: {
              albumArtUrl: queued.albumArtUrl ?? null,
              title: queued.title ?? null,
              artist: queued.artist ?? null,
            },
            fromTrackId: polledTrackIdRef.current,
            until: Date.now() + DISPLAY_OVERRIDE_MS,
          }
        }
        engine.actions.next()
        repoll()
      },
      previous: () => {
        engine.actions.previous()
        repoll()
      },
    }),
    [engine, repoll],
  )

  /**
   * The launch sequence: fetch Spotify, show the closed deck, open the lid,
   * then play.
   *
   * It lives here rather than on the no-device screen that starts it, because
   * it outlives that screen: arming the device ends the no-device state, so
   * the screen is unmounted halfway through and would take the rest of the
   * sequence with it.
   */
  const [launch, setLaunch] = useState<LaunchState>({ phase: 'idle', outcome: null })

  const runLaunch = useCallback(async (): Promise<void> => {
    setLaunch({ phase: 'running', outcome: null })

    let outcome: LaunchSpotifyResult
    try {
      outcome = await window.vuelta.launchSpotify()
    } catch {
      outcome = { kind: 'failed', message: 'Could not reach Spotify.' }
    }

    if (outcome.kind !== 'armed') {
      setLaunch({ phase: 'done', outcome })
      return
    }

    // Spotify is the active device but silent. Ask the poll for it straight
    // away so the app leaves the no-device screen now rather than at the
    // poll's own pace, then let the machine render before moving its lid.
    await pollNow()
    await new Promise((resolve) => setTimeout(resolve, STAGE_SETTLE_MS))

    setLid(true)
    await new Promise((resolve) => setTimeout(resolve, LID_SETTLE_MS))

    // Through the bridge rather than `engine.actions.play()`, which returns
    // nothing: this is the one play in the app whose answer is needed, because
    // an account with no history accepts the transfer and then has nothing to
    // resume, and that has to be told apart from success. The poll straight
    // after is what lets the engine catch up without its optimistic override.
    const played = await window.vuelta.play()
    await pollNow()
    setLaunch({
      phase: 'done',
      outcome: played.ok ? { kind: 'armed' } : { kind: 'nothing-to-resume' },
    })
  }, [pollNow, setLid])

  const beginArmDrag = useCallback(() => engine.beginArmDrag(), [engine])
  const dragToProgress = useCallback((ms: number) => engine.dragToProgress(ms), [engine])
  const endArmDrag = useCallback(() => engine.endArmDrag(Date.now()), [engine])

  return {
    stateRef,
    actions,
    launch,
    runLaunch,
    track,
    display,
    readout,
    active,
    lidOpen,
    openLid,
    closeLid,
    beginArmDrag,
    dragToProgress,
    endArmDrag,
    pollNow,
    engine,
  }
}
