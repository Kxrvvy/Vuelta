import { describe, expect, it } from 'vitest'

import { LP_RPM, PLATTER_RPM } from '../contract.js'

/**
 * The platter rate had no test at all, and it lived in two places — the state
 * layer wrote one copy into RenderState while the skin kept another as a
 * fallback. Halving the speed was exactly the kind of change that gets applied
 * to one copy and not the other, so these pin both the deviation and its size.
 */
describe('platter speed', () => {
  it('keeps the real speed of an LP as the reference', () => {
    expect(LP_RPM).toBeCloseTo(33.3333, 4)
    // 200 degrees per second, the figure the geometry used to hardcode.
    expect(LP_RPM * 6).toBeCloseTo(200, 10)
  })

  it('turns at exactly half the real speed', () => {
    expect(PLATTER_RPM).toBeCloseTo(LP_RPM / 2, 10)
    expect(PLATTER_RPM).toBeCloseTo(16.6667, 4)
  })

  it('completes a revolution in 3.6 seconds', () => {
    // The number that actually matters on screen. A real LP takes 1.8s, which
    // is what read as hurried.
    expect(360 / (PLATTER_RPM * 6)).toBeCloseTo(3.6, 10)
    expect(360 / (LP_RPM * 6)).toBeCloseTo(1.8, 10)
  })

  it('is a slowdown, never a speed-up', () => {
    expect(PLATTER_RPM).toBeLessThan(LP_RPM)
    expect(PLATTER_RPM).toBeGreaterThan(0)
  })
})
