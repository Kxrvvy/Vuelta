/**
 * Fitting the machine to the window.
 *
 * The camera used to be a constant: one distance, one look-at point, both
 * tuned by eye at a single window size. That works at exactly that size.
 * Maximised, it left a few hundred pixels of dead space beside a postage-stamp
 * panel; at the minimum size, the panel sat on top of the tonearm and the
 * volume knob and the cabinet ran off the left edge.
 *
 * So the framing is computed instead. Given the viewport and how much of its
 * right-hand side the panel is occupying, this works out how far back the
 * camera has to sit for the machine to fill the space that is left, and how
 * far to slide the look-at point so it lands in that space rather than under
 * the panel.
 *
 * Pure arithmetic on purpose — no three.js types — so the behaviour that was
 * previously a matter of taste and eyeballing is now something tests can pin
 * down. CameraRig.tsx applies the result.
 */

import { CAMERA, FIT_BOX } from './dimensions.js'

const DEG = Math.PI / 180

/** Fraction of the viewport height the machine should occupy at most. */
const FILL_V = 0.82

/** Fraction of the *free* width (viewport minus panel) it should occupy. */
const FILL_H = 0.92

/** Sanity rails. Past these the scene stops looking like a turntable. */
export const MIN_DISTANCE = 0.45
export const MAX_DISTANCE = 3.5

export type Viewport = {
  width: number
  height: number
  /** Width in CSS pixels that the overlay panel is taking on the right. */
  reserveRightPx: number
}

export type Framing = {
  distance: number
  targetX: number
  /** Camera position, derived from distance and the fixed tilt. */
  position: [number, number, number]
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * The machine's extent on screen, in world units, at the fixed camera tilt.
 *
 * Horizontally it is just the cabinet's width. Vertically the tilt mixes depth
 * and height together: looking down at an angle, the far edge of the deck and
 * the top of the lid both eat into the same vertical span.
 */
export function projectedExtent(): { horizontal: number; vertical: number } {
  const tilt = CAMERA.TILT_DEG * DEG
  return {
    horizontal: FIT_BOX.WIDTH,
    vertical: FIT_BOX.DEPTH * Math.cos(tilt) + FIT_BOX.HEIGHT * Math.sin(tilt),
  }
}

export function fitCamera(viewport: Viewport): Framing {
  const tilt = CAMERA.TILT_DEG * DEG
  const halfFovTan = Math.tan((CAMERA.FOV * DEG) / 2)
  const extent = projectedExtent()

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

  const byHeight = extent.vertical / (2 * halfFovTan * FILL_V)
  const byWidth = extent.horizontal / (2 * halfFovTan * aspect * freeFraction * FILL_H)

  const distance = clamp(Math.max(byHeight, byWidth), MIN_DISTANCE, MAX_DISTANCE)

  // Slide the look-at point right by exactly the panel's share of the frame.
  // That is what moves the machine into the free region instead of under the
  // panel — and because it is a share rather than a fixed world offset, it
  // stays correct at every window size.
  const visibleWidth = 2 * distance * halfFovTan * aspect
  const targetX = FIT_BOX.CENTER_X + (reserved / width) * (visibleWidth / 2)

  return {
    distance,
    targetX,
    position: [targetX, distance * Math.cos(tilt), distance * Math.sin(tilt)],
  }
}
