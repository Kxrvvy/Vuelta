/**
 * Which camera sees what.
 *
 * The close-up and the inset draw the *same* scene through two cameras on the
 * same frame, so a part cannot be hidden by unmounting it: the inset still
 * needs the whole machine while the close-up must show none of it. three.js
 * layers are the mechanism that lets one object be visible to one camera and
 * not the other.
 *
 * Keep this list short. A layer is invisible when it is wrong -- an object
 * left on the wrong one simply vanishes from a view, and nothing fails.
 */
export const LAYER = {
  /** The record and the tonearm. Every camera sees these. */
  COMMON: 0,
  /**
   * The machine: cabinet, lid, counter, knob, Open button, and the platter,
   * slipmat and spindle the record sits on. Everything the flat-lay has no
   * turntable for.
   */
  MACHINE: 1,
  /** The album sleeve, which exists only in the flat-lay. */
  FLATLAY: 2,
} as const

/** Bit mask for a set of layers, as three.js stores them. */
export function maskFor(...layers: number[]): number {
  return layers.reduce((mask, layer) => mask | (1 << layer), 0)
}
