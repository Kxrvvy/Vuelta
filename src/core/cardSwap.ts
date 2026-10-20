/**
 * The shape of the card move.
 *
 * In the flat-lay the album cover and the record lie overlapped, like two
 * cards on a table, and clicking the cover sends it to the back or brings it
 * to the front. It does not simply fade through the record: it slides clear,
 * changes depth where nothing is in the way, and slides back onto the stack --
 * the way you would move a card from the front of a deck to the back.
 *
 * Three ordered phases, which is exactly what `damp` cannot express: damping
 * eases toward a target and has no notion of "not yet". So the move is a pure
 * function of progress instead, which also means its shape can be stepped in a
 * test rather than watched.
 */

/** How long the whole move takes. Long enough to read as handling. */
export const CARD_SWAP_MS = 600

/** Sliding out, then crossing, then sliding back, as fractions of the move. */
const OUT_ENDS = 0.35
const CROSS_ENDS = 0.65

export type CardSwap = {
  /** 0 at rest on the stack, 1 fully clear of it. */
  out: number
  /** 0 at the starting depth, 1 at the other one. */
  crossed: number
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/** Ease both ends, so nothing starts or stops abruptly. */
function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

export function cardSwap(progress: number): CardSwap {
  const p = clamp01(progress)

  // Out, hold, back. The hold is what guarantees the card is clear of the
  // record for the whole of the depth change, so the two never intersect.
  const out =
    p <= OUT_ENDS
      ? smooth(p / OUT_ENDS)
      : p >= CROSS_ENDS
        ? smooth(1 - (p - CROSS_ENDS) / (1 - CROSS_ENDS))
        : 1

  const crossed =
    p <= OUT_ENDS ? 0 : p >= CROSS_ENDS ? 1 : smooth((p - OUT_ENDS) / (CROSS_ENDS - OUT_ENDS))

  return { out, crossed }
}
