/**
 * Dragging the record sideways to change track.
 *
 * The disc already answers a click with play/pause, and the arm already owns
 * dragging, so this is a third gesture on a surface that had two: a press on
 * the record, a slide left or right, and a release. Left takes the next track
 * and right the previous one, the way a stack of cards is pushed along -- the
 * record leaves to the left and the one behind it follows in.
 *
 * Pure, and shared by both skins. The flat-lay drags a div and the machine
 * looks drag a mesh, but what counts as a drag, how far the record follows the
 * pointer and what a release means are the same in each, and were not going to
 * stay the same if each one worked it out for itself.
 *
 * Nothing here touches playback. It turns a pointer travel into an intention;
 * the skins call `next()` and `previous()` on the actions they already hold.
 */

/**
 * How far the pointer has to move before this stops being a click.
 *
 * A press never lands perfectly still -- a mouse slips a pixel or two on the
 * way down, and a finger a good deal more -- so without a dead zone every
 * play/pause would also be a very short swipe. Below this the gesture is a
 * click and the disc does not move at all.
 */
export const CLICK_SLOP_PX = 6

/**
 * How far it has to travel before a release changes the track.
 *
 * Deliberately a long way further than the slop. The cost of being wrong is
 * asymmetric: a skip that was meant as a play/pause takes the song away and
 * there is no undo short of pressing previous, while a play/pause that was
 * meant as a skip costs one more gesture. So the threshold sits where a
 * deliberate shove reaches and an unsteady click does not.
 */
export const SWIPE_THRESHOLD_PX = 90

/**
 * The distance the record approaches but never reaches, however hard it is
 * pulled.
 *
 * The follow is asymptotic rather than linear. One-to-one, a long drag carries
 * the record off its own sheet of paper and out of the frame, and the gesture
 * stops looking like nudging a record and starts looking like a bug; with a
 * ceiling, the resistance itself says the record is held by something.
 */
export const SWIPE_RUBBER_PX = 160

export type SwipeOutcome = 'none' | 'next' | 'previous'

/** Has the pointer moved far enough that this is a drag and not a click? */
export function isSwipeDrag(dx: number, dy: number): boolean {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false
  return Math.hypot(dx, dy) > CLICK_SLOP_PX
}

/**
 * How far the record is drawn from home, for a pointer that has travelled
 * `dx`.
 *
 * `rubber * (1 - e^(-|dx| / rubber))`: it leaves home at the pointer's own
 * speed, so the first few pixels feel attached rather than sticky, and falls
 * away from there toward the ceiling. Signed, so the record follows the
 * direction of travel.
 */
export function swipeOffset(dx: number, rubber: number = SWIPE_RUBBER_PX): number {
  if (!Number.isFinite(dx) || dx === 0) return 0
  const pull = Math.abs(dx)
  const eased = rubber * (1 - Math.exp(-pull / rubber))
  return Math.sign(dx) * eased
}

/**
 * What a release after travelling `dx` horizontally and `dy` vertically does.
 *
 * The vertical test is what keeps this off the other gestures: the arm is
 * dragged across the disc and the whole scene sits under a pointer that may be
 * on its way somewhere else, so a travel that is mostly up or down is not a
 * swipe however far it goes.
 */
export function swipeOutcome(dx: number, dy: number): SwipeOutcome {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 'none'
  if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return 'none'
  if (Math.abs(dx) <= Math.abs(dy)) return 'none'
  return dx < 0 ? 'next' : 'previous'
}
