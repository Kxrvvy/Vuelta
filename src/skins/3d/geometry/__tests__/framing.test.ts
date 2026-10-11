import { describe, expect, it } from 'vitest'

import { FIT_BOX } from '../dimensions.js'
import { fitCamera, MAX_DISTANCE, MIN_DISTANCE, projectedExtent } from '../framing.js'

const PANEL = 232

const at = (width: number, height: number, reserveRightPx = PANEL) =>
  fitCamera({ width, height, reserveRightPx })

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
  it('mixes depth and height, because the camera looks down at an angle', () => {
    const extent = projectedExtent()
    expect(extent.horizontal).toBe(FIT_BOX.WIDTH)
    // Tilted, the vertical span is less than the full depth but more than
    // depth alone would suggest once the lid's height is folded in.
    expect(extent.vertical).toBeGreaterThan(0)
    expect(extent.vertical).toBeLessThan(FIT_BOX.DEPTH + FIT_BOX.HEIGHT)
  })
})
