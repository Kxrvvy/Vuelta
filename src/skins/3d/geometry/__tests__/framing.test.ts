import { describe, expect, it } from 'vitest'

import { CAMERA, FIT_BOX, type ProfilePoint, profilePoints } from '../dimensions.js'
import {
  FILL_H,
  FILL_V,
  type Framing,
  fitCamera,
  MAX_DISTANCE,
  MIN_DISTANCE,
  profile,
} from '../framing.js'

const PANEL = 232

const at = (width: number, height: number, reserveRightPx = PANEL) =>
  fitCamera({ width, height, reserveRightPx })

const front = (width: number, height: number, reserveRightPx = 0) =>
  fitCamera({ width, height, reserveRightPx, pose: 'front' })

const BAR = 74

const bottom = (width: number, height: number, reserveBottomPx = BAR, reserveRightPx = 0) =>
  fitCamera({ width, height, reserveRightPx, reserveBottomPx })

describe('which constraint binds', () => {
  it('is limited by height on a wide window', () => {
    // Plenty of width to spare, so the machine is as big as the height allows
    // and widening further changes nothing.
    const wide = at(1920, 1040)
    const wider = at(2560, 1040)
    expect(wide.distance).toBeCloseTo(wider.distance, 6)
  })

  it('is limited by width on a narrow window', () => {
    // Here width is the binding constraint, so narrowing pushes the camera
    // back rather than letting the machine run off the edge.
    const narrow = at(640, 520)
    const narrower = at(560, 520)
    expect(narrower.distance).toBeGreaterThan(narrow.distance)
  })

  it('pulls back as the panel takes more room, where width is what binds', () => {
    // Deliberately a tall, narrow viewport. On a wide one the taller open
    // silhouette makes *height* the binding constraint, and then a fatter
    // panel changes nothing — correctly, because the machine already fits
    // the space left over.
    const slim = at(700, 900, 150)
    const fat = at(700, 900, 340)
    expect(fat.distance).toBeGreaterThan(slim.distance)
  })

  it('ignores the panel when height is what binds', () => {
    const slim = at(900, 600, 150)
    const fat = at(900, 600, 340)
    expect(fat.distance).toBeCloseTo(slim.distance, 10)
  })
})

describe('the machine ends up beside the panel, not under it', () => {
  it('never shifts the look-at the wrong way', () => {
    for (const [w, h] of [
      [640, 520],
      [746, 518],
      [1280, 800],
      [1920, 1040],
    ] as const) {
      expect(at(w, h).targetX).toBeGreaterThanOrEqual(FIT_BOX.CENTER_X)
    }
  })

  it('does not shift at all when nothing is reserved', () => {
    // The hidden-panel case: with nothing to make room for, the machine sits
    // on its own centre, which is what puts it mid-window.
    expect(at(1280, 800, 0).targetX).toBeCloseTo(FIT_BOX.CENTER_X, 10)
  })

  it('shifts by whatever share of the visible width the panel takes', () => {
    // Pins how far the machine glides when the panel fades. Derived rather
    // than asserted as a magic number, so retuning the fill or the panel
    // width cannot leave this quietly wrong.
    const w = 1100
    const h = 700
    const reserve = 320
    const framing = at(w, h, reserve)
    const extent = profile(framing.elevationDeg, 'top')
    const visibleWidth = 2 * (framing.distance - extent.near) * HALF_FOV_TAN * (w / h)
    const shift = framing.targetX - FIT_BOX.CENTER_X
    expect(shift).toBeCloseTo((reserve / w) * (visibleWidth / 2), 10)
    // And it is a real distance, not a rounding artefact.
    expect(shift).toBeGreaterThan(extent.horizontal * 0.1)
  })

  it('shifts further the more of the frame the panel occupies', () => {
    // Same panel in pixels, narrower window: a bigger share, so a bigger shift
    // measured against the machine's own size.
    const big = at(1600, 800)
    const small = at(700, 800)
    const asShareOfMachine = (f: { targetX: number }) =>
      (f.targetX - FIT_BOX.CENTER_X) / FIT_BOX.WIDTH
    expect(asShareOfMachine(small)).toBeGreaterThan(asShareOfMachine(big))
  })

  it('positions the camera above and in front of the target', () => {
    const framing = at(1280, 800)
    const [x, y, z] = framing.position
    expect(x).toBeCloseTo(framing.targetX, 10)
    expect(y).toBeGreaterThan(0) // above
    expect(z).toBeGreaterThan(0) // and toward the viewer, so we look down and back
  })
})

describe('degenerate viewports', () => {
  it('survives a minimised window reporting 0 x 0', () => {
    const framing = at(0, 0)
    expect(Number.isFinite(framing.distance)).toBe(true)
    expect(Number.isFinite(framing.targetX)).toBe(true)
    expect(framing.position.every(Number.isFinite)).toBe(true)
  })

  it('survives NaN and negative dimensions', () => {
    for (const framing of [at(Number.NaN, 600), at(-100, -100), at(800, Number.NaN)]) {
      expect(Number.isFinite(framing.distance)).toBe(true)
      expect(Number.isFinite(framing.targetX)).toBe(true)
    }
  })

  it('refuses to let the panel claim the entire window', () => {
    // A reserve wider than the viewport would make the free region zero or
    // negative and send the distance to infinity.
    const framing = at(600, 500, 9000)
    expect(Number.isFinite(framing.distance)).toBe(true)
    expect(framing.distance).toBeLessThanOrEqual(MAX_DISTANCE)
  })
})

describe('rails', () => {
  it('clamps at both ends', () => {
    expect(at(100, 20_000).distance).toBeLessThanOrEqual(MAX_DISTANCE)
    expect(at(20_000, 20_000, 0).distance).toBeGreaterThanOrEqual(MIN_DISTANCE)
  })
})

const HALF_FOV_TAN = Math.tan(((CAMERA.FOV * Math.PI) / 180) / 2)
const DEG = Math.PI / 180

describe('the silhouette', () => {
  it('is taller with the lid up than with it shut', () => {
    const open = profile(CAMERA.TOP_ELEVATION_DEG, 'top')
    const shut = profile(CAMERA.TOP_ELEVATION_DEG, 'front')
    expect(open.vertical).toBeGreaterThan(shut.vertical)
  })

  it('measures the outline, not a bounding box around it', () => {
    // A box would call the open silhouette ~0.570 tall. The points say 0.482.
    // The difference is the whole reason this change costs an 18% shrink
    // rather than 31%.
    const open = profile(CAMERA.TOP_ELEVATION_DEG, 'top')
    expect(open.vertical).toBeCloseTo(0.482, 2)
    expect(open.vertical).toBeLessThan(0.52)
  })

  it('includes the raised lid only in the open pose', () => {
    expect(profilePoints('top').length).toBeGreaterThan(profilePoints('front').length)
  })

  it('finds the lid tip to be nearest the lens once the lid is up', () => {
    // Not something a bounding box could know: the camera is above, so the
    // raised lid is closer than anything on the cabinet.
    expect(profile(CAMERA.TOP_ELEVATION_DEG, 'top').near).toBeGreaterThan(
      profile(CAMERA.TOP_ELEVATION_DEG, 'front').near,
    )
  })
})

describe('where the camera looks', () => {
  it('looks above deck level with the lid up, below it head-on', () => {
    // The sign of the fix, in both directions. Looking at deck level with the
    // lid raised is what left ~13.5% of the frame empty underneath.
    expect(at(1100, 700, 0).targetY).toBeGreaterThan(0)
    expect(front(1100, 700).targetY).toBeLessThan(0)
  })

  it('puts the centre of the outline exactly at the look-at', () => {
    for (const [pose, framing] of [
      ['top', at(1100, 700, 0)],
      ['front', front(1100, 700)],
    ] as const) {
      const extent = profile(framing.elevationDeg, pose)
      const lookAtHeight = framing.targetY * Math.cos(framing.elevationDeg * DEG)
      expect(lookAtHeight).toBeCloseTo(extent.center, 10)
    }
  })
})

describe('nothing crops', () => {
  it('fits every extreme point in both poses', () => {
    // Checked at the nearest point, which is the worst case — anything
    // further from the lens has more room, not less.
    for (const [pose, framing, w, h] of [
      ['top', at(1100, 700, 0), 1100, 700],
      ['front', front(1100, 700), 1100, 700],
      ['top', at(640, 520, 0), 640, 520],
      ['front', front(640, 520), 640, 520],
    ] as const) {
      const extent = profile(framing.elevationDeg, pose)
      const visibleHeight = 2 * (framing.distance - extent.near) * HALF_FOV_TAN
      expect(extent.vertical).toBeLessThanOrEqual(visibleHeight)
      expect(extent.horizontal).toBeLessThanOrEqual(visibleHeight * (w / h))
    }
  })

  it('keeps the camera outside the machine', () => {
    expect(at(1100, 700, 0).distance).toBeGreaterThan(
      profile(CAMERA.TOP_ELEVATION_DEG, 'top').near,
    )
  })
})

describe('the front pose', () => {
  it('is width-constrained where the top pose is height-constrained', () => {
    const wideTop = at(1920, 1040, 0)
    const widerTop = at(2560, 1040, 0)
    expect(wideTop.distance).toBeCloseTo(widerTop.distance, 6)

    const narrowFront = front(900, 700)
    const widerFront = front(1600, 700)
    expect(widerFront.distance).toBeLessThan(narrowFront.distance)
  })

  it('puts the camera lower and at a shallower angle than the top pose', () => {
    const top = at(1280, 800, 0)
    const head = front(1280, 800)
    expect(head.position[1]).toBeLessThan(top.position[1])
    expect(head.elevationDeg).toBeLessThan(top.elevationDeg)
    // Not asserting z: the open silhouette pushes the top camera so far back
    // that its z component now exceeds the front camera's, which is fine.
  })

  it('stays finite on a degenerate viewport, like the top pose', () => {
    for (const framing of [front(0, 0), front(Number.NaN, 600), front(-10, -10)]) {
      expect(Number.isFinite(framing.distance)).toBe(true)
      expect(Number.isFinite(framing.targetY)).toBe(true)
      expect(framing.position.every(Number.isFinite)).toBe(true)
    }
  })
})

describe('how much of the frame the machine fills', () => {
  it('fills exactly FILL_V of the height when height is what binds', () => {
    // Asserted against the constant rather than a copy of its value, so
    // retuning the size cannot silently leave this test lying.
    const framing = at(1920, 1040, 0)
    const extent = profile(CAMERA.TOP_ELEVATION_DEG, 'top')
    const visibleHeight = 2 * (framing.distance - extent.near) * HALF_FOV_TAN
    expect(extent.vertical / visibleHeight).toBeCloseTo(FILL_V, 6)
  })

  it('fills FILL_H of the free width when width is what binds', () => {
    const w = 700
    const h = 900
    const reserve = 150
    const framing = at(w, h, reserve)
    const extent = profile(CAMERA.TOP_ELEVATION_DEG, 'top')
    const visibleWidth = 2 * (framing.distance - extent.near) * HALF_FOV_TAN * (w / h)
    const freeWidth = visibleWidth * ((w - reserve) / w)
    expect(extent.horizontal / freeWidth).toBeCloseTo(FILL_H, 6)
  })

  it('leaves margin on every side — neither fraction reaches 1', () => {
    expect(FILL_V).toBeLessThan(1)
    expect(FILL_H).toBeLessThan(1)
  })
})

/**
 * Where a point of the outline lands on screen, as a fraction of the half
 * frame: -1 is the bottom edge, +1 the top.
 *
 * Derived from the camera the framing actually describes, rather than from the
 * same arithmetic the framing used, so a sign error in the look-at shift
 * cannot pass by agreeing with itself.
 */
function screenY(framing: Framing, point: ProfilePoint): number {
  const elevation = framing.elevationDeg * DEG
  const cos = Math.cos(elevation)
  const sin = Math.sin(elevation)

  // Height on the screen axis, relative to the point being looked at.
  const up = point.y * cos - point.z * sin - framing.targetY * cos
  // Distance along the view direction.
  const depth = framing.distance + framing.targetY * sin - (point.y * sin + point.z * cos)
  return up / (depth * HALF_FOV_TAN)
}

describe('the bar along the bottom', () => {
  it('leaves the machine exactly where it was when nothing is reserved', () => {
    // The default. Every call site predating the bar must be unaffected.
    const without = at(1100, 700, 0)
    const zero = bottom(1100, 700, 0)
    expect(zero.targetY).toBeCloseTo(without.targetY, 10)
    expect(zero.distance).toBeCloseTo(without.distance, 10)
  })

  it('lowers the look-at, which is what raises the machine on screen', () => {
    // The direction is the whole point, and it is the easy thing to get
    // backwards: dropping the target lifts the subject.
    expect(bottom(1100, 700).targetY).toBeLessThan(at(1100, 700, 0).targetY)
    // Not asserting the camera's own height: reserving room also pushes it
    // back along its elevation ray, and that lifts it by more than the
    // look-at drops. Only the look-at carries the meaning here.
  })

  it('raises it by exactly the share of the frame the bar occupies', () => {
    // Derived rather than asserted as a magic number, so retuning the fill or
    // the bar height cannot leave this quietly wrong.
    const h = 700
    const framing = bottom(1100, h)
    const extent = profile(framing.elevationDeg, 'top')
    const visibleHeight = 2 * (framing.distance - extent.near) * HALF_FOV_TAN
    const shiftOnScreen =
      (extent.targetY - framing.targetY) * Math.cos(framing.elevationDeg * DEG)
    expect(shiftOnScreen).toBeCloseTo((BAR / h) * (visibleHeight / 2), 10)
  })

  it('pulls the camera back, because height is what binds on a wide window', () => {
    expect(bottom(1600, 800).distance).toBeGreaterThan(at(1600, 800, 0).distance)
  })

  it('ignores the bar when width is what binds', () => {
    // A tall narrow window: the machine is already as small as the width
    // demands, so there is nothing for the bar to take.
    const slim = fitCamera({ width: 620, height: 1000, reserveRightPx: 0, reserveBottomPx: 0 })
    const barred = fitCamera({ width: 620, height: 1000, reserveRightPx: 0, reserveBottomPx: BAR })
    expect(barred.distance).toBeCloseTo(slim.distance, 10)
  })

  it('still centres horizontally, so the two reserves do not interfere', () => {
    expect(bottom(1280, 800).targetX).toBeCloseTo(FIT_BOX.CENTER_X, 10)
    expect(bottom(1280, 800, BAR, 240).targetX).toBeGreaterThan(FIT_BOX.CENTER_X)
  })

  it('refuses to let the bar claim the entire window', () => {
    const framing = bottom(600, 500, 9000)
    expect(Number.isFinite(framing.distance)).toBe(true)
    expect(Number.isFinite(framing.targetY)).toBe(true)
    expect(framing.distance).toBeLessThanOrEqual(MAX_DISTANCE)
  })

  it('survives degenerate viewports, like the other reserve', () => {
    for (const framing of [
      bottom(0, 0),
      bottom(Number.NaN, 600),
      bottom(800, Number.NaN),
      bottom(800, 600, Number.NaN),
      bottom(-100, -100),
    ]) {
      expect(Number.isFinite(framing.distance)).toBe(true)
      expect(Number.isFinite(framing.targetY)).toBe(true)
      expect(framing.position.every(Number.isFinite)).toBe(true)
    }
  })

  it('puts no part of the machine behind the bar', () => {
    // The assertion the whole change exists for. Checked by projecting every
    // extreme point through the resulting camera, at several window shapes and
    // in both poses, against the top edge of the reserved strip.
    for (const [pose, w, h, bar] of [
      ['top', 1100, 700, BAR],
      ['top', 1600, 900, BAR],
      ['top', 640, 520, BAR],
      ['top', 900, 600, 140],
      ['front', 1100, 700, BAR],
    ] as const) {
      const framing = fitCamera({
        width: w,
        height: h,
        reserveRightPx: 0,
        reserveBottomPx: bar,
        pose,
      })
      const barTop = -1 + 2 * (bar / h)
      for (const point of profilePoints(pose)) {
        expect(screenY(framing, point)).toBeGreaterThanOrEqual(barTop)
        // And still inside the top of the frame.
        expect(screenY(framing, point)).toBeLessThanOrEqual(1)
      }
    }
  })
})
