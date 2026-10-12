import { describe, expect, it } from 'vitest'

import { CAMERA, FIT_BOX } from '../dimensions.js'
import {
  fitCamera,
  MAX_DISTANCE,
  MIN_DISTANCE,
  nearOffset,
  projectedExtent,
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

  it('pulls back as the panel takes more room', () => {
    const slim = at(900, 600, 150)
    const fat = at(900, 600, 340)
    expect(fat.distance).toBeGreaterThan(slim.distance)
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
    expect(at(1280, 800, 0).targetX).toBeCloseTo(FIT_BOX.CENTER_X, 10)
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

describe('projectedExtent', () => {
  it('mixes depth and height according to the viewing angle', () => {
    const top = projectedExtent(CAMERA.TOP_ELEVATION_DEG)
    expect(top.horizontal).toBe(FIT_BOX.WIDTH)
    expect(top.vertical).toBeGreaterThan(0)
    expect(top.vertical).toBeLessThan(FIT_BOX.DEPTH + FIT_BOX.HEIGHT)
  })

  it('is dominated by depth overhead and by height head-on', () => {
    // This is the whole reason one elevation number can describe both views.
    const top = projectedExtent(CAMERA.TOP_ELEVATION_DEG)
    const head = projectedExtent(CAMERA.FRONT_ELEVATION_DEG)
    expect(top.vertical).toBeGreaterThan(head.vertical)
    expect(head.vertical).toBeGreaterThan(FIT_BOX.HEIGHT * 0.9)
  })
})

describe('the front pose', () => {
  it('is width-constrained where the top pose is height-constrained', () => {
    // Head-on the machine is wide and short, so width binds; overhead it is
    // deep and fills the frame vertically.
    const wideTop = at(1920, 1040, 0)
    const widerTop = at(2560, 1040, 0)
    expect(wideTop.distance).toBeCloseTo(widerTop.distance, 6)

    const narrowFront = front(900, 700)
    const widerFront = front(1600, 700)
    expect(widerFront.distance).toBeLessThan(narrowFront.distance)
  })

  it('puts the camera lower and further forward than the top pose', () => {
    const [, topY, topZ] = at(1280, 800, 0).position
    const [, frontY, frontZ] = front(1280, 800).position
    expect(frontY).toBeLessThan(topY)
    expect(frontZ).toBeGreaterThan(topZ)
  })

  it('looks at the vertical midpoint of the machine, not at deck level', () => {
    // Targeting y = 0 is near enough looking down and clearly wrong head-on.
    expect(front(1280, 800).targetY).toBeCloseTo(FIT_BOX.CENTER_Y, 10)
    expect(FIT_BOX.CENTER_Y).toBeLessThan(0)
  })

  it('stays finite on a degenerate viewport, like the top pose', () => {
    for (const framing of [front(0, 0), front(Number.NaN, 600), front(-10, -10)]) {
      expect(Number.isFinite(framing.distance)).toBe(true)
      expect(framing.position.every(Number.isFinite)).toBe(true)
    }
  })
})

describe('the 15% shrink', () => {
  it('holds the machine further back than the fill fractions it was tuned at', () => {
    // Previously FILL_V 0.82; now 0.70. Height-constrained, the distance
    // should have grown by very close to 0.82 / 0.70.
    const heightBound = at(1920, 1040, 0)
    const extent = projectedExtent(CAMERA.TOP_ELEVATION_DEG)
    const halfFovTan = Math.tan(((CAMERA.FOV * Math.PI) / 180) / 2)
    const near = nearOffset(CAMERA.TOP_ELEVATION_DEG)
    // Compared at the near face, which is what the fill fractions govern.
    const atOldFill = extent.vertical / (2 * halfFovTan * 0.82)
    expect((heightBound.distance - near) / atOldFill).toBeCloseTo(0.82 / 0.7, 2)
  })
})

describe('perspective', () => {
  it('fits the near face, not the centre of the box', () => {
    // A perspective camera projects the closest surface. Fitting to the
    // centre let the front panel overflow the frame by ~40% head-on, because
    // it sits most of the cabinet's depth nearer than the middle.
    const halfFovTan = Math.tan(((CAMERA.FOV * Math.PI) / 180) / 2)
    for (const [framing, elevation] of [
      [front(1100, 656), CAMERA.FRONT_ELEVATION_DEG],
      [at(1100, 656, 0), CAMERA.TOP_ELEVATION_DEG],
    ] as const) {
      const near = framing.distance - nearOffset(elevation)
      const visibleHeight = 2 * near * halfFovTan
      const extent = projectedExtent(elevation)
      // The visible face must sit inside the frame with room to spare.
      expect(extent.vertical).toBeLessThan(visibleHeight)
      expect(extent.horizontal).toBeLessThan(visibleHeight * (1100 / 656))
    }
  })

  it('pushes the camera further back than a centre-fit would', () => {
    expect(front(1100, 656).distance).toBeGreaterThan(
      nearOffset(CAMERA.FRONT_ELEVATION_DEG),
    )
  })
})
