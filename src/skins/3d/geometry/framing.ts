/**
 * Fitting the machine to the window, from either of two angles.
 *
 * The camera used to be a constant: one distance, one look-at point, both
 * tuned by eye at a single window size. That works at exactly that size.
 * Maximised, it left a few hundred pixels of dead space beside a postage-stamp
 * panel; at the minimum size, the panel sat on top of the tonearm and the
 * volume knob and the cabinet ran off the left edge.
 *
 * So the framing is computed instead. Given the viewport, how much of its
 * right-hand side the panel is occupying, and which way the machine is being
 * looked at, this works out how far back the camera has to sit for the machine
 * to fill the space that is left, and how far to slide the look-at point so it
 * lands in that space rather than under the panel.
 *
 * The two poses differ by exactly one number — the elevation above the horizon
 * — because the projected extent was always a mix of depth and height weighted
 * by the viewing angle. Overhead, depth dominates; head-on, height does.
 *
 * Pure arithmetic on purpose — no three.js types — so behaviour that was
 * previously a matter of eyeballing is something tests can pin down.
 * CameraRig.tsx applies the result and animates between poses.
 */

import { CAMERA, type CameraPose, elevationFor, FIT_BOX } from './dimensions.js'

const DEG = Math.PI / 180

/**
 * How much of the frame the machine fills.
 *
 * Both were cut by 15% from the values they were first tuned at (0.82 and
 * 0.92). Scaling the fill fractions rather than hard-coding a larger distance
 * keeps the reduction at 15% for every window size and both poses, which a
 * fixed distance would not.
 */
const FILL_V = 0.7
const FILL_H = 0.78

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
  targetY: number
  elevationDeg: number
  /** Camera position, derived from distance and elevation. */
  position: [number, number, number]
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * The machine's extent on screen, in world units, at a given elevation.
 *
 * Horizontally it is just the cabinet's width, whichever way you look at it.
 * Vertically the angle mixes depth and height: from overhead the deck's depth
 * fills the frame and its height barely registers, and from head-on it is the
 * other way round.
 */
export function projectedExtent(elevationDeg: number): {
  horizontal: number
  vertical: number
} {
  const elevation = elevationDeg * DEG
  return {
    horizontal: FIT_BOX.WIDTH,
    vertical: FIT_BOX.DEPTH * Math.sin(elevation) + FIT_BOX.HEIGHT * Math.cos(elevation),
  }
}

/**
 * How much nearer the closest face of the machine is than its centre.
 *
 * This matters more than it sounds. A perspective camera projects the near
 * face, not the middle of the box, so fitting to the centre distance lets the
 * front of the machine overflow the frame — badly in the head-on view, where
 * the front panel sits most of the cabinet's depth closer than the centre.
 * Adding this back onto the distance makes the *visible* face obey the fill
 * fractions, which is what they were always meant to mean.
 */
export function nearOffset(elevationDeg: number): number {
  const elevation = elevationDeg * DEG
  return (FIT_BOX.DEPTH / 2) * Math.cos(elevation) + (FIT_BOX.HEIGHT / 2) * Math.sin(elevation)
}

export function fitCamera(viewport: Viewport): Framing {
  const elevationDeg = elevationFor(viewport.pose ?? 'top')
  const elevation = elevationDeg * DEG
  const halfFovTan = Math.tan((CAMERA.FOV * DEG) / 2)
  const extent = projectedExtent(elevationDeg)

  // A minimised window reports 0 × 0. Every ratio below would become Infinity
  // or NaN and poison the camera's matrix, so fall back to something sane and
  // let the next real resize fix it.
  const width = Number.isFinite(viewport.width) && viewport.width > 0 ? viewport.width : 1
  const height = Number.isFinite(viewport.height) && viewport.height > 0 ? viewport.height : 1
  const aspect = width / height

  // Never let the panel claim so much that there is no room left to fit into.
  const reserved = clamp(
    Number.isFinite(viewport.reserveRightPx) ? viewport.reserveRightPx : 0,
    0,
    width * 0.6,
  )
  const freeFraction = (width - reserved) / width

  // Fit the near face, then push the camera back out to the box centre.
  const near = nearOffset(elevationDeg)
  const byHeight = extent.vertical / (2 * halfFovTan * FILL_V) + near
  const byWidth = extent.horizontal / (2 * halfFovTan * aspect * freeFraction * FILL_H) + near

  const distance = clamp(Math.max(byHeight, byWidth), MIN_DISTANCE, MAX_DISTANCE)

  // Slide the look-at point right by exactly the panel's share of the frame.
  // That is what moves the machine into the free region instead of under the
  // panel — and because it is a share rather than a fixed world offset, it
  // stays correct at every window size.
  // Measured at the near face, for the same reason.
  const visibleWidth = 2 * (distance - near) * halfFovTan * aspect
  const targetX = FIT_BOX.CENTER_X + (reserved / width) * (visibleWidth / 2)

  return {
    distance,
    targetX,
    targetY: FIT_BOX.CENTER_Y,
    elevationDeg,
    position: [
      targetX,
      FIT_BOX.CENTER_Y + distance * Math.sin(elevation),
      distance * Math.cos(elevation),
    ],
  }
}
