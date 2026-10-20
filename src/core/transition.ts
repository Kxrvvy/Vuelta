/**
 * The record swap — spec §13, CLAUDE.md "Track transitions".
 *
 * Anticipated, not reactive. The swap begins when the *local clock* reads
 * about two seconds remaining, not when a poll reports that the track already
 * changed: a poll arrives up to five seconds late, and a swap that starts then
 * is a swap the user has already heard happen.
 *
 * Two entries, because there are two different events:
 *
 *   the boundary   retract, swap while hidden, extend. The whole gesture, and
 *                  it starts *before* the track changes.
 *   a load         extend only. A skip, a playlist starting, or the first
 *                  track after launch -- the record is simply pulled out of
 *                  the sleeve, which is §9's "loading a track".
 *
 * The art and the label change at exactly one instant: the retract→swapping
 * boundary, when the disc is completely behind the sleeve. `showNext` is that
 * instant, and it is why the crossfade is never visible.
 *
 * Pure, and no timers: `core/` has no DOM, so the caller supplies `deltaMs`
 * and this returns the next state. That is also what makes the whole sequence
 * steppable in a test rather than something to be watched.
 */

/** How much of the track must be left for the boundary swap to arm. */
export const SWAP_LEAD_MS = 2000

/** Disc slides back behind the sleeve. */
export const RETRACT_MS = 700
/** Hidden. Art crossfades, label text swaps. */
export const CROSSFADE_MS = 220
/** New disc slides out. §9's load, and the tail of the boundary swap. */
export const EXTEND_MS = 900

/** 1820ms, inside spec §13's 2–3 second budget for the whole animation. */
export const SWAP_TOTAL_MS = RETRACT_MS + CROSSFADE_MS + EXTEND_MS

export type TransitionPhase = 'idle' | 'retracting' | 'swapping' | 'extending'

export type Transition = {
  phase: TransitionPhase
  /** Milliseconds spent in the current phase. */
  elapsedMs: number
  /** 0 fully hidden behind the sleeve, 1 fully out. The skin scales a slide by it. */
  out: number
  /**
   * Draw the *next* track's art and label rather than the current one.
   *
   * True only between the moment the disc is hidden and the moment the real
   * track change lands, which is the window in which the app's own idea of
   * "current" is still the track that just finished.
   */
  showNext: boolean
  /**
   * False once a boundary swap has run for the track now playing, so a clock
   * that lingers near the end cannot fire the same swap twice. A real track
   * change re-arms it.
   */
  armed: boolean
  /**
   * True from the moment an anticipated swap begins until the track change it
   * was anticipating actually lands.
   *
   * Without it the swap plays twice. The anticipated one runs two seconds
   * early, finishes, and returns to idle; then the poll confirms the change
   * and `trackChanged` fires into an idle machine, which reads as a fresh load
   * and animates the whole thing again. Observed in the running app: a second
   * slide started 1.3s after the first had settled.
   */
  expecting: boolean
}

export const IDLE_TRANSITION: Transition = {
  phase: 'idle',
  elapsedMs: 0,
  out: 1,
  showNext: false,
  armed: true,
  expecting: false,
}

export type TransitionInput = {
  deltaMs: number
  /** From the local clock, not from a poll. */
  remainingMs: number
  durationMs: number
  /** The track id changed since the previous step. */
  trackChanged: boolean
  /** The queue pre-fetch found something to swap to. */
  hasNext: boolean
  isPlaying: boolean
}

function easeInCubic(t: number): number {
  return t * t * t
}

function easeOutCubic(t: number): number {
  const u = 1 - t
  return 1 - u * u * u
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/**
 * Whether the boundary swap may start.
 *
 * `durationMs > SWAP_TOTAL_MS` is the guard that matters: a track with no
 * duration reports zero remaining forever — Spotify sends no `item` for local
 * files and some podcasts — and a track shorter than the animation has no room
 * to play it.
 */
function shouldAnticipate(input: TransitionInput, armed: boolean): boolean {
  if (!armed || !input.isPlaying || !input.hasNext) return false
  if (!Number.isFinite(input.durationMs) || input.durationMs <= SWAP_TOTAL_MS) return false
  if (!Number.isFinite(input.remainingMs)) return false
  // Strictly inside the lead. A clock that has already run past the end reads
  // zero or less, and that is exactly the state the frames right after an
  // absorbed track change are in -- arming there would start a second swap on
  // the track that just began.
  return input.remainingMs > 0 && input.remainingMs <= SWAP_LEAD_MS
}

export function stepTransition(prev: Transition, input: TransitionInput): Transition {
  const delta = Number.isFinite(input.deltaMs) ? Math.max(0, input.deltaMs) : 0

  // A real track change means the app's `albumArtUrl` has caught up, so the
  // next track *is* the current one now and `showNext` has done its job. It
  // also re-arms the boundary swap for the track that just started.
  const showNext = input.trackChanged ? false : prev.showNext
  const armed = input.trackChanged ? true : prev.armed

  // A change that an anticipated swap already played for is *this* swap's
  // change arriving late, not a new one. Consume it and animate nothing.
  const anticipated = input.trackChanged && prev.expecting
  const expecting = input.trackChanged ? false : prev.expecting

  if (prev.phase === 'idle') {
    // A frame that carries a track change never also *starts* an anticipated
    // swap. The change is either one to animate or one to absorb, and the
    // clock has not yet caught up to the new track either way.
    if (input.trackChanged) {
      // Loading: a skip, a new context, or the first track after launch. The
      // record is pulled out of the sleeve and that is the whole animation.
      if (!anticipated) {
        return {
          phase: 'extending',
          elapsedMs: 0,
          out: 0,
          showNext: false,
          armed: true,
          expecting: false,
        }
      }
      // Absorbed: this is the change the swap just played for.
      return { ...prev, elapsedMs: 0, out: 1, showNext: false, armed: true, expecting: false }
    }
    if (shouldAnticipate(input, armed)) {
      return {
        phase: 'retracting',
        elapsedMs: 0,
        out: 1,
        showNext: false,
        armed: false,
        expecting: true,
      }
    }
    return { ...prev, elapsedMs: 0, out: 1, showNext, armed, expecting }
  }

  const elapsed = prev.elapsedMs + delta

  if (prev.phase === 'retracting') {
    if (elapsed >= RETRACT_MS) {
      // The one instant the artwork and the label change, with the disc
      // completely behind the sleeve.
      return {
        phase: 'swapping',
        elapsedMs: elapsed - RETRACT_MS,
        out: 0,
        showNext: true,
        armed,
        expecting,
      }
    }
    return {
      phase: 'retracting',
      elapsedMs: elapsed,
      out: 1 - easeInCubic(clamp01(elapsed / RETRACT_MS)),
      showNext,
      armed,
      expecting,
    }
  }

  if (prev.phase === 'swapping') {
    if (elapsed >= CROSSFADE_MS) {
      return {
        phase: 'extending',
        elapsedMs: elapsed - CROSSFADE_MS,
        out: 0,
        showNext,
        armed,
        expecting,
      }
    }
    return { phase: 'swapping', elapsedMs: elapsed, out: 0, showNext, armed, expecting }
  }

  // extending
  if (elapsed >= EXTEND_MS) {
    return { phase: 'idle', elapsedMs: 0, out: 1, showNext, armed, expecting }
  }
  return {
    phase: 'extending',
    elapsedMs: elapsed,
    out: easeOutCubic(clamp01(elapsed / EXTEND_MS)),
    showNext,
    armed,
    expecting,
  }
}

/** True while the arm should be lifted clear for the swap. */
export function isSwapping(phase: TransitionPhase): boolean {
  return phase !== 'idle'
}
