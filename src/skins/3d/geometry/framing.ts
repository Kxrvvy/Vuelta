/**
 * Fitting the machine to the window, from either of two angles.
 *
 * The camera used to be a constant: one distance, one look-at point, both
 * tuned by eye at a single window size. That works at exactly that size.
 * Maximised, it left a few hundred pixels of dead space beside a postage-stamp
 * panel; at the minimum size, the panel sat on top of the tonearm and the
 * volume knob and the cabinet ran off the left edge.
 *
 * So the framing is computed instead. Given the viewport, how much of it the
 * chrome is occupying — the panel down the right, the browser bar along the
 * bottom — and which way the machine is being looked at, this works out how
 * far back the camera has to sit for the machine to fill the space that is
 * left, and how far to slide the look-at point so it lands in that space
 * rather than underneath something.
 *
 * The two poses differ by exactly one number — the elevation above the horizon
 * — because the projected extent was always a mix of depth and height weighted
 * by the viewing angle. Overhead, depth dominates; head-on, height does.
 *
 * Pure arithmetic on purpose — no three.js types — so behaviour that was
 * previously a matter of eyeballing is something tests can pin down.
 * CameraRig.tsx applies the result and animates between poses.
 */

import {
  CAMERA,
  type CameraPose,
  elevationFor,
  FIT_BOX,
  type ProfilePoint,
  profilePoints,
} from './dimensions.js'

const DEG = Math.PI / 180

/**
 * How much of the frame the machine fills.
 *
 * Exported because they are the dial for how big the turntable renders, and
 * because the tests assert against them rather than against copies of the
 * numbers. Scaling these rather than hard-coding a distance keeps the size
 * consistent at every window size and in both poses.
 *
 * These are *measured* fractions, not nominal ones. They used to be fed into
 * an orthographic approximation that undershot them — at 1100x700 a nominal
 * 0.77 drew a machine 0.709 of the frame tall. The solver below hits the
 * number exactly, so some of these read smaller than the figures they replace
 * while drawing a larger machine.
 *
 * The two poses are sized separately, which they were not before. Only the
 * open view was asked to grow; the closed one is a different composition —
 * head-on, much wider than it is tall, and width-bound at most window shapes,
 * so a shared FILL_H silently grew it by the same 10.5%.
 */

/** Lid open. History: 0.82 / 0.92, cut 15%, raised 10%, then raised 11%. */
export const FILL_V = 0.737
export const FILL_H = 0.95

/**
 * Lid shut, kept at the size it has always been.
 *
 * Not round numbers because they are not new ones. They were calibrated by
 * measuring what the previous nominal 0.77 / 0.86 actually drew for this pose
 * and solving for the measured fractions that reproduce it, which they do to
 * within a pixel from 980x680 up to 2560x1040.
 *
 * Only the width figure survived unchanged, because a width-bound fit simply
 * draws FILL_H of the window whatever the maths behind it. The height figure
 * moved a long way — 0.77 of a flat estimate turns out to be 0.5675 of the
 * frame — which is a fair measure of how far off that estimate was.
 *
 * Width binds head-on at most window shapes, including the 980x680 the app
 * opens at, so FILL_H_FRONT governs this view in practice. FILL_V_FRONT takes
 * over past roughly 16:9 and keeps the machine from running away on a very
 * wide window.
 */
export const FILL_V_FRONT = 0.5675
export const FILL_H_FRONT = 0.86

function fillFor(pose: CameraPose): { v: number; h: number } {
  if (pose === 'front') return { v: FILL_V_FRONT, h: FILL_H_FRONT }
  return { v: FILL_V, h: FILL_H }
}

/** Sanity rails. Past these the scene stops looking like a turntable. */
export const MIN_DISTANCE = 0.45
export const MAX_DISTANCE = 3.5

export type Viewport = {
  width: number
  height: number
  /** Width in CSS pixels that the overlay panel is taking on the right. */
  reserveRightPx: number
  /** Which way the machine is being looked at. Defaults to the overhead view. */
  pose?: CameraPose
}

export type Framing = {
  distance: number
  targetX: number
  /** The look-at height that centres the machine vertically in the window. */
  targetY: number
  /**
   * How far the look-at slides along the deck to clear the inset's band.
   *
   * Zero everywhere but the flat-lay. It is `z` and not `y` because of the
   * angle: at 86 degrees the look-at's *height* barely moves anything up or
   * down the screen -- cos(86) is 0.07 -- so asking the solver to make room by
   * raising it sent it three quarters of a metre into the air and collapsed
   * the composition to a third of its size. Depth is the axis that maps to
   * screen-vertical from overhead.
   */
  targetZ: number
  elevationDeg: number
  /** Camera position, derived from distance and elevation. */
  position: [number, number, number]
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * The machine's outline, measured on screen, for a given viewing angle.
 *
 * Both numbers come from the same projection of the same points, rather than
 * from three separate approximations off a bounding box:
 *
 *   h     — position on the screen's vertical axis
 *   depth — position along the axis running toward the camera
 *
 * `extent` and `center` govern how big the machine is and where to look;
 * `near` is how much closer the nearest part of it is than the point being
 * looked at. That last one is why a box was never good enough: a perspective
 * camera projects the nearest surface, and once the lid is up the nearest
 * surface is the lid's tip, not anything on the cabinet.
 */
export function profile(elevationDeg: number, pose: CameraPose) {
  const box = FIT_BOX
  const elevation = elevationDeg * DEG
  const cos = Math.cos(elevation)
  const sin = Math.sin(elevation)

  let minH = Infinity
  let maxH = -Infinity
  let maxDepth = -Infinity

  for (const { y, z } of profilePoints(pose)) {
    const h = y * cos - z * sin
    if (h < minH) minH = h
    if (h > maxH) maxH = h
    const depth = y * sin + z * cos
    if (depth > maxDepth) maxDepth = depth
  }

  const center = (maxH + minH) / 2
  return {
    horizontal: box.WIDTH,
    vertical: maxH - minH,
    /** Height of the outline's centre on the screen axis. */
    center,
    /**
     * Where the camera should look so that centre lands mid-frame. The target
     * sits on the z = 0 plane, so h = targetY * cos(elevation).
     */
    targetY: center / cos,
    /** How far the nearest point sits in front of that target. */
    near: maxDepth - (center / cos) * sin,
  }
}

/**
 * The outline's top and bottom edges as the camera actually projects them, in
 * half-frame units: -1 is the bottom of the window, +1 the top.
 *
 * This is the part a bounding box, and the orthographic `profile()` above,
 * both get wrong. A perspective camera divides every point by its own depth,
 * and the machine is not flat: with the lid up its tip is both the highest
 * point and the nearest one, so it projects larger than the cabinet's far
 * bottom edge. Centring the orthographic midpoint therefore left the machine
 * sitting high - at 1100x700 the gaps came out 81px above and 124px below.
 */
function projectedSpan(
  points: readonly ProfilePoint[],
  elevation: number,
  distance: number,
  targetY: number,
  halfFovTan: number,
): { lo: number; hi: number } {
  const cos = Math.cos(elevation)
  const sin = Math.sin(elevation)

  let lo = Infinity
  let hi = -Infinity

  for (const { y, z } of points) {
    const up = y * cos - z * sin - targetY * cos
    // Never divide by a depth at or behind the lens.
    const depth = Math.max(distance + targetY * sin - (y * sin + z * cos), 1e-4)
    const n = up / (depth * halfFovTan)
    if (n < lo) lo = n
    if (n > hi) hi = n
  }

  return { lo, hi }
}

/**
 * How far the outline's nearest point reaches toward the lens, measured along
 * the view axis from the look-at point.
 *
 * The machine is the same width at every depth, so what decides how wide it
 * draws is simply whichever part is closest: the raised lid from overhead,
 * the front edge head-on. Depth of that point is `distance + targetY * sin`
 * minus this.
 */
function reachTowardLens(points: readonly ProfilePoint[], elevation: number): number {
  const cos = Math.cos(elevation)
  const sin = Math.sin(elevation)

  let maxAlong = -Infinity
  for (const { y, z } of points) {
    const along = y * sin + z * cos
    if (along > maxAlong) maxAlong = along
  }
  return maxAlong
}

/**
 * The look-at height that lands the outline's projected centre on `aim`.
 *
 * Solved rather than derived: `targetY` appears in both the numerator and the
 * denominator of every point's projection, and which point is topmost can
 * change as the camera moves, so there is no clean closed form. Raising the
 * look-at moves everything down the screen, which makes the midpoint strictly
 * decreasing in `targetY` - so bisection is reliable and needs no derivative.
 *
 * Forty halvings of a 3-metre bracket resolve to well under a micrometre,
 * far finer than a pixel at any window size.
 */
function solveTargetY(
  points: readonly ProfilePoint[],
  elevation: number,
  distance: number,
  halfFovTan: number,
  aim: number,
  seed: number,
): number {
  let low = seed - 1.5
  let high = seed + 1.5

  const offBy = (t: number) => {
    const { lo, hi } = projectedSpan(points, elevation, distance, t, halfFovTan)
    return (lo + hi) / 2 - aim
  }

  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2
    if (offBy(mid) > 0) low = mid
    else high = mid
  }

  return (low + high) / 2
}

/**
 * Results, cached by argument.
 *
 * `fitCamera` runs inside `useFrame`, so it is called up to sixty times a
 * second with arguments that change only on a resize or a pose change. The
 * solver is cheap but not free, and recomputing an identical answer every
 * frame is waste.
 *
 * A single slot was enough while there was one camera. The close-up view puts
 * two on screen -- the record in the main frame, the whole machine in the
 * inset -- and they ask different questions of this function on the same
 * frame, so a one-entry cache would miss on every single call and run two
 * full six-pass solves per frame instead of none.
 */
const CACHE_LIMIT = 8
const cache = new Map<string, Framing>()

export function fitCamera(viewport: Viewport): Framing {
  const pose = viewport.pose ?? 'top'

  // A minimised window reports 0 x 0. Every ratio below would become Infinity
  // or NaN and poison the camera's matrix, so fall back to something sane and
  // let the next real resize fix it.
  const width = Number.isFinite(viewport.width) && viewport.width > 0 ? viewport.width : 1
  const height = Number.isFinite(viewport.height) && viewport.height > 0 ? viewport.height : 1

  // Never let either reserve claim so much that there is no room left to fit
  // into. The caps differ because the panel is a column and the bar a strip:
  // a panel can legitimately take half a narrow window, a bar never should.
  const reserved = clamp(
    Number.isFinite(viewport.reserveRightPx) ? viewport.reserveRightPx : 0,
    0,
    width * 0.6,
  )

  // Every argument that changes the answer has to be in the key. A reserve
  // left out of it returns a stale framing, and the symptom is a band that is
  // simply ignored -- which looks exactly like not having implemented it.
  const key = pose + '|' + width + '|' + height + '|' + reserved
  const hit = cache.get(key)
  if (hit) return hit

  const box = FIT_BOX
  const elevationDeg = elevationFor(pose)
  const elevation = elevationDeg * DEG
  const halfFovTan = Math.tan((CAMERA.FOV * DEG) / 2)
  const extent = profile(elevationDeg, pose)
  const points = profilePoints(pose)
  const aspect = width / height

  const freeFraction = (width - reserved) / width
  const fill = fillFor(pose)

  const fillV = fill.v

  // Start from the old closed form, then correct it. It is a good opening
  // guess and a poor answer: it measures the outline orthographically and adds
  // the near distance back, which undershoots the true projected size.
  const near = extent.near
  const reach = reachTowardLens(points, elevation)
  let distance = extent.vertical / (2 * halfFovTan * fillV) + near
  let targetY = extent.targetY

  // Both constraints have to be solved together, not one after the other.
  //
  // Each pass re-centres the look-at for the current distance, then asks what
  // distance the height and the width each want *given that look-at*, and
  // takes whichever is further. The coupling is real: moving the look-at
  // slides the camera along its own axis, which changes how near the closest
  // part of the machine is, which changes how wide it draws. Solving width
  // once after the fact left it about half a percent out.
  //
  // Six passes settle both to well under a pixel. At the fixed point the
  // look-at and the distance agree, so the final re-centre below changes
  // nothing and the measured fills land exactly on their constants.
  const wantedNear = box.WIDTH / (2 * halfFovTan * aspect * freeFraction * fill.h)
  const sin = Math.sin(elevation)

  for (let pass = 0; pass < 6; pass++) {
    targetY = solveTargetY(points, elevation, distance, halfFovTan, 0, targetY)

    const { lo, hi } = projectedSpan(points, elevation, distance, targetY, halfFovTan)
    const measured = (hi - lo) / 2
    // Projected size falls off with distance from the near face, so correcting
    // there converges much faster than scaling the whole distance.
    const byHeight =
      Number.isFinite(measured) && measured > 0
        ? near + (distance - near) * (measured / fillV)
        : distance

    // Width needs no iteration of its own: the machine is one constant width,
    // so the wanted distance follows directly from where its nearest point
    // has to sit.
    const byWidth = wantedNear + reach - targetY * sin

    distance = clamp(Math.max(byHeight, byWidth), MIN_DISTANCE, MAX_DISTANCE)
  }

  // Re-centre at the distance finally chosen. A no-op once converged, and the
  // thing that keeps the view sane when a clamp cut the loop short.
  targetY = solveTargetY(points, elevation, distance, halfFovTan, 0, targetY)

  // Slide the look-at right by exactly the panel's share of the frame. That is
  // what moves the machine into the free region instead of under the panel,
  // and because it is a share rather than a fixed world offset it stays
  // correct at every window size.
  const visibleWidth = 2 * (distance - near) * halfFovTan * aspect
  const targetX = box.CENTER_X + (reserved / width) * (visibleWidth / 2)

  // Nothing is reserved along the top any more. The inset that needed a band
  // of its own went with the 3D close-up, and the flat-lay that replaced it is
  // a separate skin with no camera in it at all.
  const targetZ = 0

  // Nothing is reserved along the bottom, on purpose. Exact centring leaves a
  // margin of (1 - FILL_V) / 2 beneath the machine, which at the smallest
  // window Vuelta opens is already taller than the browser bar - so the bar
  // sits in empty space without the camera moving for it.
  //
  // The alternative was tried and removed. Shifting the look-at up to clear
  // the bar also moves the camera nearer, which made the machine grow about
  // 6% whenever the bar faded in and out on its idle timer. Breathing on a
  // timer is far worse than a strip of chrome over an empty margin, and
  // keeping the machine centred is what was actually asked for.
  // `bottomMarginFits` in the tests is what holds this invariant.
  const framing: Framing = {
    distance,
    targetX,
    targetY,
    targetZ,
    elevationDeg,
    position: [
      targetX,
      targetY + distance * Math.sin(elevation),
      targetZ + distance * Math.cos(elevation),
    ],
  }

  // Bounded, and oldest-first: the keys that keep being asked for are a
  // handful -- one per pose per viewport -- but a resize drag produces a new
  // one every frame and an unbounded map would keep every width ever seen.
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, framing)
  return framing
}
