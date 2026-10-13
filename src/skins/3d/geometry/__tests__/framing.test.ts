import { describe, expect, it } from 'vitest'

import { CAMERA, FIT_BOX, type ProfilePoint, profilePoints } from '../dimensions.js'
import {
  FILL_H,
  FILL_H_FRONT,
  FILL_V,
  FILL_V_FRONT,
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

  it('looks above the orthographic centre of the outline, not at it', () => {
    // It used to look exactly at profile()'s centre, and that was the bug. A
    // perspective camera magnifies by depth, and with the lid up the tip is
    // both the highest point and the nearest, so it projects further than its
    // flat height suggests. Balancing the picture means looking higher, which
    // pushes the machine down into the space it was leaving empty.
    const framing = at(1100, 700, 0)
    const extent = profile(framing.elevationDeg, 'top')
    const lookAtHeight = framing.targetY * Math.cos(framing.elevationDeg * DEG)
    expect(lookAtHeight).toBeGreaterThan(extent.center)
  })

  it('corrects the front pose too, by more than the top one', () => {
    // Worth pinning because the obvious guess is wrong. The raised lid makes
    // the top pose look like the lopsided one, but head-on at 10 degrees the
    // cabinet's whole depth is spread along the view axis, so the near and
    // far edges differ by more there than they do from overhead. Neither pose
    // was ever well served by the flat estimate.
    const headOn = front(1100, 700)
    const overhead = at(1100, 700, 0)
    const correction = (f: Framing, pose: 'top' | 'front') =>
      Math.abs(
        f.targetY * Math.cos(f.elevationDeg * DEG) - profile(f.elevationDeg, pose).center,
      )
    expect(correction(headOn, 'front')).toBeGreaterThan(correction(overhead, 'top'))
    expect(correction(overhead, 'top')).toBeGreaterThan(0.01)
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
  it('is understated by the orthographic estimate, which is why it is solved', () => {
    // Measures the gap the solver closes. Feeding FILL_V into the flat
    // estimate drew a machine noticeably smaller than FILL_V of the frame,
    // because the estimate overstates the outline it is dividing by. The real
    // fill is asserted against FILL_V in 'vertical centring' below; this pins
    // that the two genuinely disagree, so nobody reverts to the cheap version
    // thinking it was equivalent.
    const framing = at(1920, 1040, 0)
    const extent = profile(CAMERA.TOP_ELEVATION_DEG, 'top')
    const visibleHeight = 2 * (framing.distance - extent.near) * HALF_FOV_TAN
    expect(extent.vertical / visibleHeight).toBeGreaterThan(FILL_V)
  })

  it('fills FILL_H of the free width when width is what binds', () => {
    // Measured through the camera the framing describes, the same way FILL_V
    // is. The flat version of this used the orthographic near distance and
    // ignored the look-at entirely, so it drifted the moment the look-at was
    // solved rather than assumed.
    const w = 700
    const h = 900
    const reserve = 150
    const framing = at(w, h, reserve)
    const freeFraction = (w - reserve) / w
    expect(widthFraction(framing, 'top', w, h) / freeFraction).toBeCloseTo(FILL_H, 6)
  })

  it('fills FILL_H_FRONT head-on, which is the size the closed lid has always had', () => {
    // The two poses are sized apart. Only the open view was raised 11%; this
    // pins that the closed one did not come along with it.
    for (const [w, h] of [
      [980, 680],
      [1100, 700],
      [640, 520],
    ] as const) {
      expect(widthFraction(front(w, h), 'front', w, h)).toBeCloseTo(FILL_H_FRONT, 6)
    }
  })

  it('caps the closed lid by height once the window is wider than about 16:9', () => {
    // Past that aspect a width-bound fit would keep growing the machine with
    // the window. FILL_V_FRONT takes over and holds it. Both constants were
    // calibrated together so the closed view reproduces its previous size at
    // every shape, not only the ones where width happens to bind.
    for (const [w, h] of [
      [1920, 1040],
      [2560, 1040],
    ] as const) {
      const framing = front(w, h)
      expect(widthFraction(framing, 'front', w, h)).toBeLessThan(FILL_H_FRONT)
      const { lo, hi } = span(framing, 'front')
      expect((hi - lo) / 2).toBeCloseTo(FILL_V_FRONT, 4)
    }
  })

  it('sizes the two poses independently', () => {
    // The open view fills more of the frame than the closed one, which is the
    // whole point of them having separate constants.
    expect(FILL_H).toBeGreaterThan(FILL_H_FRONT)
    expect(FILL_V).toBeGreaterThan(FILL_V_FRONT)
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
 * same arithmetic the framing used, so an error in the look-at cannot pass by
 * agreeing with itself.
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

/**
 * How much of the frame's width the machine occupies.
 *
 * The machine is one constant width, so this is decided entirely by whichever
 * part of it is nearest the lens: the raised lid from overhead, the front
 * edge head-on.
 */
function widthFraction(framing: Framing, pose: 'top' | 'front', w: number, h: number): number {
  const elevation = framing.elevationDeg * DEG
  const sin = Math.sin(elevation)
  const cos = Math.cos(elevation)

  let maxAlong = -Infinity
  for (const { y, z } of profilePoints(pose)) {
    const along = y * sin + z * cos
    if (along > maxAlong) maxAlong = along
  }

  const minDepth = framing.distance + framing.targetY * sin - maxAlong
  return FIT_BOX.WIDTH / (2 * minDepth * HALF_FOV_TAN * (w / h))
}

/** The outline's lowest and highest points on screen, in the same units. */
function span(framing: Framing, pose: 'top' | 'front') {
  let lo = Infinity
  let hi = -Infinity
  for (const point of profilePoints(pose)) {
    const n = screenY(framing, point)
    if (n < lo) lo = n
    if (n > hi) hi = n
  }
  return { lo, hi }
}

/**
 * The browser bar's footprint, measured from the bottom of the window:
 * its 0.85rem inset plus its own 38px height.
 *
 * Copied from styles.css because CSS cannot be imported here. It is checked
 * rather than assumed: `.browser` sets the inset and `.browser__bar` the
 * padding, and if either grows past the margin the machine leaves, the bar
 * starts overlapping the cabinet.
 */
const BAR_FOOTPRINT_PX = 52

describe('vertical centring', () => {
  it('leaves exactly equal margins above and below', () => {
    // The assertion this whole solver exists for. The orthographic fit it
    // replaced came out 81px above and 124px below at 1100x700, because a
    // perspective camera magnifies the near lid tip more than the far bottom
    // edge and the old maths measured neither.
    for (const [w, h] of [
      [1100, 700],
      [1600, 900],
      [980, 680],
      [640, 520],
      [2560, 1040],
    ] as const) {
      const framing = at(w, h, 0)
      const { lo, hi } = span(framing, 'top')
      const topGapPx = ((1 - hi) / 2) * h
      const bottomGapPx = ((lo + 1) / 2) * h
      expect(topGapPx).toBeCloseTo(bottomGapPx, 4)
    }
  })

  it('centres the front pose too', () => {
    const framing = front(1100, 700)
    const { lo, hi } = span(framing, 'front')
    expect(hi + lo).toBeCloseTo(0, 6)
  })

  it('fills FILL_V of the frame as a measured fact, not a nominal one', () => {
    // Asserted against the constant rather than a copy of its value, so
    // retuning the size cannot silently leave this test lying.
    for (const [w, h] of [
      [1100, 700],
      [1920, 1040],
    ] as const) {
      const { lo, hi } = span(at(w, h, 0), 'top')
      expect((hi - lo) / 2).toBeCloseTo(FILL_V, 4)
    }
  })
})

describe('room for the browser bar', () => {
  it('leaves a bottom margin the bar fits inside, down to the smallest window', () => {
    // No camera reserve is made for the bar. Instead the margin that exact
    // centring already leaves has to be deep enough to hold it. 520px is the
    // minimum window height main/index.ts allows, and is the binding case.
    for (const [w, h] of [
      [640, 520],
      [980, 680],
      [1100, 700],
      [1920, 1040],
    ] as const) {
      const { lo } = span(at(w, h, 0), 'top')
      const bottomGapPx = ((lo + 1) / 2) * h
      expect(bottomGapPx).toBeGreaterThan(BAR_FOOTPRINT_PX)
    }
  })

  it('still clears the bar with the panel showing', () => {
    // The panel pushes the machine sideways and can make width the binding
    // constraint, which only ever leaves more vertical room, never less.
    const { lo } = span(at(640, 520), 'top')
    expect(((lo + 1) / 2) * 520).toBeGreaterThan(BAR_FOOTPRINT_PX)
  })
})
