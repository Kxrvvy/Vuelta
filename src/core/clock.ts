/**
 * The one module that owns `progressMs` — CLAUDE.md, spec §8.
 *
 * Three things want to write this number: the poll response, the local clock
 * running between polls, and the user dragging the tonearm. If all three write
 * it, the arm jitters and fights the user. So only this module writes it:
 *
 *   tick()       advances it between polls
 *   reconcile()  nudges it toward the truth a poll just reported
 *   beginDrag()  suspends both until release
 *
 * No timers and no rAF live here. `core/` has no DOM and no Node globals, so
 * `requestAnimationFrame` does not exist in this file — and that is the right
 * shape anyway: the rules are here and testable with a fake delta, while the
 * tick source is injected by `src/app/useSync.ts`.
 */

import type { PlaybackSnapshot } from './contract.js'

/** Under this much drift, leave it alone. Correcting noise looks like jitter. */
export const RECONCILE_DEADBAND_MS = 500

/**
 * Over this much drift, stop easing and snap. Easing across a gap this large
 * would take long enough to read as the UI being wrong.
 */
export const RECONCILE_SNAP_MS = 2000

/** How fast an accepted correction is absorbed. ~1.5s to effectively settle. */
const CORRECTION_LAMBDA = 2

export type ClockReading = {
  progressMs: number
  durationMs: number
  isPlaying: boolean
  isDragging: boolean
}

export type Clock = {
  /** Advance by a frame. Safe to call at any rate; it integrates `deltaMs`. */
  tick(deltaMs: number): void
  /** Fold in what the server reported. Eases, snaps, or ignores. */
  reconcile(snapshot: Pick<PlaybackSnapshot, 'progressMs' | 'isPlaying'>): void
  setDuration(durationMs: number): void
  setPlaying(isPlaying: boolean): void
  /** Jump outright — used when the track changes, where easing is wrong. */
  hardSet(progressMs: number): void
  beginDrag(): void
  dragTo(progressMs: number): void
  /** Ends the drag and returns the position to commit as a seek. */
  endDrag(): number
  read(): ClockReading
}

export function createClock(initial?: Partial<ClockReading>): Clock {
  let progressMs = initial?.progressMs ?? 0
  let durationMs = initial?.durationMs ?? 0
  let isPlaying = initial?.isPlaying ?? false
  let isDragging = false

  /** Drift still to be absorbed, in ms. Bled off a little each tick. */
  let correction = 0

  const clamp = (value: number) => {
    if (!Number.isFinite(value) || value < 0) return 0
    if (durationMs > 0 && value > durationMs) return durationMs
    return value
  }

  return {
    tick(deltaMs) {
      // A drag owns the value outright; the clock stands down until release.
      if (isDragging || !Number.isFinite(deltaMs) || deltaMs <= 0) return

      if (isPlaying) progressMs += deltaMs

      if (correction !== 0) {
        // Frame-rate independent exponential approach, so the correction
        // absorbs at the same wall-clock rate however fast the loop runs.
        const step = correction * (1 - Math.exp((-CORRECTION_LAMBDA * deltaMs) / 1000))
        progressMs += step
        correction -= step
        if (Math.abs(correction) < 1) correction = 0
      }

      progressMs = clamp(progressMs)
    },

    reconcile(snapshot) {
      isPlaying = snapshot.isPlaying
      if (isDragging) return // the user is authoritative while dragging

      const drift = snapshot.progressMs - progressMs

      if (Math.abs(drift) < RECONCILE_DEADBAND_MS) {
        // Close enough. Correcting this would be visible jitter for no gain.
        correction = 0
        return
      }

      if (Math.abs(drift) > RECONCILE_SNAP_MS) {
        // Too far to ease across — a track change, a seek from the Spotify
        // client, or a long stall. Accept it outright.
        progressMs = clamp(snapshot.progressMs)
        correction = 0
        return
      }

      // Spec §8: "ease toward truth rather than snapping".
      correction = drift
    },

    setDuration(next) {
      durationMs = Number.isFinite(next) && next > 0 ? next : 0
      progressMs = clamp(progressMs)
    },

    setPlaying(next) {
      isPlaying = next
    },

    hardSet(next) {
      progressMs = clamp(next)
      correction = 0
    },

    beginDrag() {
      isDragging = true
      correction = 0
    },

    dragTo(next) {
      if (!isDragging) return
      progressMs = clamp(next)
    },

    endDrag() {
      isDragging = false
      correction = 0
      return progressMs
    },

    read() {
      return { progressMs, durationMs, isPlaying, isDragging }
    },
  }
}
