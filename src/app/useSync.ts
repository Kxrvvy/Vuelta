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
import { armAngleFor } from '../core/armMath.js'
import type {
  Actions,
  PlayerPoll,
  RenderState,
  TrackSummary,
} from '../core/contract.js'
import { ARM, INITIAL_RENDER_STATE, PLATTER_RPM } from '../core/contract.js'
import type { Engine } from '../core/engine.js'
import { createEngine } from '../core/engine.js'
import type { PlaybackPort } from '../core/ports.js'
import type { VueltaStore } from '../core/store.js'
import { isPollFailure, nextPollDelay } from '../core/syncPolicy.js'

/** Panel text refresh. The scene reads the ref at 60fps; text needs 4Hz. */
const READOUT_HZ = 4

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

export type Sync = {
  /** Live state for the skin. Mutated in place; never triggers a render. */
  stateRef: React.RefObject<RenderState>
  actions: Actions
  /** Structural — changes rarely, so it is real React state. */
  track: TrackSummary | null
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

  const [lidOpen, setLidOpen] = useState(false)
  const [track, setTrack] = useState<TrackSummary | null>(null)
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
      // Cue-lever pause: the arm holds its angle when paused and returns to
      // the cradle only when the lid closes. That is the stop gesture.
      state.armAngle = lidOpenRef.current
        ? armAngleFor(value.progressMs, value.durationMs)
        : ARM.REST_ANGLE

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

  // ---- the lid -------------------------------------------------------------
  // Two one-way controls rather than a toggle. The Open button releases the
  // latch; clicking the acrylic shuts it. Each is a no-op in the state where
  // it has nothing to do, so neither can undo the other by accident.
  const setLid = useCallback(
    (open: boolean) => {
      if (lidOpenRef.current === open) return
      lidOpenRef.current = open
      setLidOpen(open)
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

  const beginArmDrag = useCallback(() => engine.beginArmDrag(), [engine])
  const dragToProgress = useCallback((ms: number) => engine.dragToProgress(ms), [engine])
  const endArmDrag = useCallback(() => engine.endArmDrag(Date.now()), [engine])

  return {
    stateRef,
    actions: engine.actions,
    track,
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
