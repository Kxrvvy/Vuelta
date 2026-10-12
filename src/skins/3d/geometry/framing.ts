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

import {
  CAMERA,
  type CameraPose,
  elevationFor,
  FIT_BOX,
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
 * History: first tuned at 0.82 / 0.92, cut 15%, then raised 10%.
 */
export const FILL_V = 0.77
export const FILL_H = 0.86

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
    horizontal: FIT_BOX.WIDTH,
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

export function fitCamera(viewport: Viewport): Framing {
  const pose = viewport.pose ?? 'top'
  const elevationDeg = elevationFor(pose)
  const elevation = elevationDeg * DEG
  const halfFovTan = Math.tan((CAMERA.FOV * DEG) / 2)
  const extent = profile(elevationDeg, pose)

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

  // Fit the nearest part of the outline, then push the camera back out to the
  // point it is looking at.
  const near = extent.near
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
    targetY: extent.targetY,
    elevationDeg,
    position: [
      targetX,
      extent.targetY + distance * Math.sin(elevation),
      distance * Math.cos(elevation),
    ],
  }
}
