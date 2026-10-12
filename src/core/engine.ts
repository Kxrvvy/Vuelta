/**
 * The M1 state layer: the clock, the reconciler, and the optimistic overrides,
 * wired together behind one surface.
 *
 * This is the module the spec calls the most important engineering detail in
 * the app (§8). Everything in it is pure in the sense that matters: no timers,
 * no rAF, no DOM, no knowledge of Spotify. It is handed a `PlaybackPort` and a
 * clock source, and `src/app/useSync.ts` drives it.
 *
 * Reading order: clock.ts owns progressMs, overrides.ts protects user actions
 * from in-flight polls, syncPolicy.ts decides when to poll next. This file is
 * the seam between them.
 */

import type { Actions, PlaybackSnapshot, PlayerPoll, TrackSummary } from './contract.js'
import type { Clock } from './clock.js'
import { createClock } from './clock.js'
import type { Optimistic } from './overrides.js'
import { optimistic, withinMs } from './overrides.js'
import type { NowFn, PlaybackPort } from './ports.js'

/** CLAUDE.md: "volume throttled to ~1 call per 400ms". */
export const VOLUME_THROTTLE_MS = 400

/**
 * How close a reported position must be to a seek for the claim to be
 * considered honoured. Generous, because playback has moved on by the time
 * the next poll lands.
 */
const SEEK_TOLERANCE_MS = 2500

export type EffectiveState = {
  progressMs: number
  durationMs: number
  isPlaying: boolean
  isDragging: boolean
  track: TrackSummary | null
  volumePercent: number | null
  deviceName: string | null
  /** The playlist or album in play, so the browser bar can act on it. */
  contextUri: string | null
}

export type CommandFailure = { code: string; message: string }

export type Engine = {
  /** The contract skins are given. Fire-and-forget, as `Actions` declares. */
  readonly actions: Actions
  /** Advance the clock and flush any throttled volume. Driven from rAF. */
  tick(deltaMs: number, now: number): void
  /** Fold a poll result in. Returns whether it counted as a failure. */
  applyPoll(poll: PlayerPoll, now: number): { failure: boolean; retryAfterMs?: number }
  /** Current values with overrides applied — what the skin should render. */
  read(now: number): EffectiveState
  beginArmDrag(): void
  dragToProgress(progressMs: number): void
  /** Ends the drag and commits the seek. */
  endArmDrag(now: number): void
  /** The most recent command failure, for the app to surface. */
  takeFailure(): CommandFailure | null
  readonly clock: Clock
}

export function createEngine(options: { port: PlaybackPort; now?: NowFn }): Engine {
  const port = options.port
  const now = options.now ?? (() => Date.now())

  const clock = createClock()

  // One claim per thing a user action can change. Spec §8 lists exactly these.
  const playing: Optimistic<boolean> = optimistic<boolean>()
  const position: Optimistic<number> = optimistic<number>(withinMs(SEEK_TOLERANCE_MS))
  const trackId: Optimistic<string | null> = optimistic<string | null>()
  const volume: Optimistic<number> = optimistic<number>()

  let track: TrackSummary | null = null
  let volumePercent: number | null = null
  let deviceName: string | null = null
  let contextUri: string | null = null
  let failure: CommandFailure | null = null

  // Throttled volume. The claim lands immediately so the knob responds, while
  // the network call waits its turn — and the last value always gets sent.
  let pendingVolume: number | null = null
  // Negative infinity, not 0: starting at 0 would make the throttle swallow
  // the very first volume change until a window had elapsed.
  let lastVolumeSentAt = Number.NEGATIVE_INFINITY

  function record(result: { ok: boolean; code?: string; message?: string }): void {
    if (!result.ok && result.code && result.message) {
      failure = { code: result.code, message: result.message }
    }
  }

  function fire(run: () => Promise<{ ok: boolean; code?: string; message?: string }>): void {
    // Actions are fire-and-forget by contract. A rejected promise here would
    // otherwise become an unhandled rejection and take the renderer with it.
    void run()
      .then(record)
      .catch((cause: unknown) => {
        failure = { code: 'unknown', message: cause instanceof Error ? cause.message : String(cause) }
      })
  }

  const actions: Actions = {
    play() {
      playing.claim(true, now())
      clock.setPlaying(true)
      fire(() => port.play())
    },

    pause() {
      playing.claim(false, now())
      clock.setPlaying(false)
      fire(() => port.pause())
    },

    seek(ms: number) {
      const target = Math.max(0, Math.round(ms))
      position.claim(target, now())
      clock.hardSet(target)
      fire(() => port.seek(target))
    },

    next() {
      // Claim an unknown track so the next poll's *old* track is discarded.
      // This is the exact case spec §8 warns about.
      trackId.claim(null, now())
      position.claim(0, now())
      clock.hardSet(0)
      fire(() => port.next())
    },

    previous() {
      trackId.claim(null, now())
      position.claim(0, now())
      clock.hardSet(0)
      fire(() => port.previous())
    },

    setVolume(percent: number) {
      const target = Math.max(0, Math.min(100, Math.round(percent)))
      volume.claim(target, now())
      volumePercent = target
      pendingVolume = target
    },
  }

  function flushVolume(at: number): void {
    if (pendingVolume === null) return
    if (at - lastVolumeSentAt < VOLUME_THROTTLE_MS) return
    const value = pendingVolume
    pendingVolume = null
    lastVolumeSentAt = at
    fire(() => port.setVolume(value))
  }

  function adoptSnapshot(snapshot: PlaybackSnapshot, at: number): void {
    const serverTrackId = snapshot.track?.trackId ?? null
    const claimedTrack = trackId.peek(at)

    // A claim of `null` means "we skipped, we do not yet know to what". Any
    // reported track resolves it — including the old one if the skip failed,
    // once the claim expires.
    if (claimedTrack === null && trackId.isActive(at) && serverTrackId !== null) {
      const previousId = track?.trackId ?? null
      if (serverTrackId !== previousId) {
        trackId.clear()
      } else {
        // Still the old track: the skip has not landed yet. Discard this poll's
        // track and position rather than snapping backwards.
        clock.setPlaying(snapshot.isPlaying)
        return
      }
    }

    const changedTrack = serverTrackId !== (track?.trackId ?? null)
    track = snapshot.track
    deviceName = snapshot.deviceName
    contextUri = snapshot.contextUri
    clock.setDuration(snapshot.track?.durationMs ?? 0)

    if (volume.peek(at) === undefined) volumePercent = snapshot.volumePercent
    else volume.settle(snapshot.volumePercent ?? -1, at)

    const claimedPlaying = playing.peek(at)
    const effectivePlaying =
      claimedPlaying === undefined ? snapshot.isPlaying : playing.settle(snapshot.isPlaying, at)

    if (changedTrack) {
      // Easing across a track boundary makes no sense — the number means
      // something different now.
      clock.hardSet(snapshot.progressMs)
      clock.setPlaying(effectivePlaying)
      position.clear()
      return
    }

    if (position.isActive(at)) {
      // A seek is in flight. Let it settle against what the server reports,
      // and leave the clock alone until it does.
      position.settle(snapshot.progressMs, at)
      clock.setPlaying(effectivePlaying)
      return
    }

    clock.reconcile({ progressMs: snapshot.progressMs, isPlaying: effectivePlaying })
  }

  return {
    actions,
    clock,

    tick(deltaMs, at) {
      clock.tick(deltaMs)
      flushVolume(at)
    },

    applyPoll(poll, at) {
      switch (poll.kind) {
        case 'ok':
          adoptSnapshot(poll.snapshot, at)
          return { failure: false }
        case 'no-device':
          // Not an error. Spotify simply is not the active device.
          clock.setPlaying(false)
          return { failure: false }
        case 'error':
          return poll.retryAfterMs === undefined
            ? { failure: true }
            : { failure: true, retryAfterMs: poll.retryAfterMs }
      }
    },

    read(at) {
      const reading = clock.read()
      const claimedPlaying = playing.peek(at)
      return {
        progressMs: reading.progressMs,
        durationMs: reading.durationMs,
        isPlaying: claimedPlaying ?? reading.isPlaying,
        isDragging: reading.isDragging,
        track,
        volumePercent: volume.peek(at) ?? volumePercent,
        deviceName,
        contextUri,
      }
    },

    beginArmDrag() {
      clock.beginDrag()
    },

    dragToProgress(progressMs) {
      clock.dragTo(progressMs)
    },

    endArmDrag(at) {
      const target = clock.endDrag()
      // Spec §10: commit on release only, never during the drag.
      position.claim(target, at)
      fire(() => port.seek(target))
    },

    takeFailure() {
      const current = failure
      failure = null
      return current
    },
  }
}
