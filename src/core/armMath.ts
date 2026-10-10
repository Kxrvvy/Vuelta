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
