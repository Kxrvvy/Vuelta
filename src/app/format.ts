/**
 * Display formatting, in one place.
 *
 * Shared because the panel and the browser bar both show durations, and two
 * copies of a clock formatter is how they end up disagreeing about what to do
 * with a negative or a NaN.
 */

/** Milliseconds as `m:ss`. Clamps at zero; never renders a negative clock. */
export function mmss(ms: number): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`
}
