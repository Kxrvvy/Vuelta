/**
 * Tonearm geometry — spec §10.
 *
 * Pure, and deliberately in core/ rather than in the skin: spec §15 names
 * `armMath` as a core module, and it must stay testable with no DOM and no
 * three.js. The skin consumes the number; it does not compute it.
 */

import { ARM } from './contract.js'

const SWEEP = ARM.END_ANGLE - ARM.START_ANGLE

/**
 * Where the arm sits for a given position in a track.
 *
 *   armAngle = START + (progressMs / durationMs) × (END − START)
 *
 * Clamped at both ends: a progress value past the duration is routine — the
 * local clock runs ahead of the poll between reconciliations — and must not
 * send the arm through the spindle.
 */
export function armAngleFor(progressMs: number, durationMs: number): number {
  // A track with no duration has nothing to sweep across. This happens for a
  // real reason, not just defensively: Spotify reports no `item` for local
  // files and some podcast episodes, so durationMs is legitimately 0.
  if (!Number.isFinite(durationMs) || durationMs <= 0) return ARM.START_ANGLE
  if (!Number.isFinite(progressMs)) return ARM.START_ANGLE

  const ratio = clamp01(progressMs / durationMs)
  return ARM.START_ANGLE + ratio * SWEEP
}

/**
 * Where the arm sits, with every rule about resting applied.
 *
 * Three states, in order of precedence:
 *
 *   dragging  the user's hand is on the arm, and it outranks everything
 *   parked    lid shut, or paused — the arm goes back to its rest position
 *   playing   on the groove, at the position the clock reports
 *
 * **Pause parks the arm.** It used to hover at its current angle, lifted a
 * few millimetres, on the reasoning that a cue lever does not return the arm
 * to its cradle. That is true of the machine and was the wrong call for this
 * app: a paused turntable that has visibly *stopped* reads better than one
 * frozen mid-sweep, and the rest position is the only part of the arm's travel
 * that says "not playing" on its own.
 *
 * A drag still works while paused, and the seek still commits on release —
 * the arm simply returns to rest afterwards, because it is still paused.
 *
 * Here rather than in the state layer so the rule can be stepped in a test;
 * it is the kind of thing that is easy to get subtly wrong and impossible to
 * notice.
 */
export function armAngleNow(input: {
  lidOpen: boolean
  isPlaying: boolean
  isDragging: boolean
  progressMs: number
  durationMs: number
}): number {
  if (input.isDragging) return armAngleFor(input.progressMs, input.durationMs)
  if (!input.lidOpen || !input.isPlaying) return ARM.REST_ANGLE
  return armAngleFor(input.progressMs, input.durationMs)
}

/**
 * The inverse of `armAngleFor`: where in the track an arm angle lands.
 *
 * This is what dragging the tonearm needs. The pointer sets an angle; this
 * turns it into the position to seek to on release.
 *
 * Clamped to the groove band at both ends, so a drag past the lead-in or the
 * run-out cannot produce a seek outside the track.
 */
export function progressForArmAngle(armAngle: number, durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0
  if (!Number.isFinite(armAngle)) return 0

  const ratio = clamp01((armAngle - ARM.START_ANGLE) / SWEEP)
  return ratio * durationMs
}

/** Clamp an angle to the playable band — never onto the label or off the rim. */
export function clampToGroove(armAngle: number): number {
  if (!Number.isFinite(armAngle)) return ARM.START_ANGLE
  if (armAngle < ARM.START_ANGLE) return ARM.START_ANGLE
  if (armAngle > ARM.END_ANGLE) return ARM.END_ANGLE
  return armAngle
}

/**
 * Fraction of the record consumed, 0–1. Used by the skin to decide how far in
 * the groove band the stylus sits, independently of the arm's own rotation.
 */
export function trackProgressRatio(progressMs: number, durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0
  if (!Number.isFinite(progressMs)) return 0
  return clamp01(progressMs / durationMs)
}

/** True when the arm should be lifted off the record entirely. */
export function isAtRest(armAngle: number): boolean {
  return armAngle <= ARM.REST_ANGLE
}

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}
