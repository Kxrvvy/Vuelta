/**
 * Display formatting.
 *
 * In core rather than beside any one caller because three layers now show a
 * clock: the now-playing panel, the floating readout at the needle, and the
 * counter on the deck. Two copies of a time formatter is how they end up
 * disagreeing about what to do with a negative or a NaN.
 *
 * Pure and DOM-free, like everything else here.
 */

/** Milliseconds as `m:ss`. Clamps at zero; never renders a negative clock. */
export function mmss(ms: number): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`
}
