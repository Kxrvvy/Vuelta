import { describe, expect, it } from 'vitest'

import { LP_RPM, PLATTER_RPM } from '../../../../core/contract.js'
import {
  ARM_SWEEP_DEG,
  PLATTER_DEG_PER_SEC,
  RECORD,
  TONEARM,
} from '../dimensions.js'

describe('the platter rate agrees with the contract', () => {
  it('derives from PLATTER_RPM rather than restating it', () => {
    // The skin and the state layer both feed the same spin. If these two ever
    // disagree, the disc changes speed depending on which one is driving.
    expect(PLATTER_DEG_PER_SEC).toBeCloseTo(PLATTER_RPM * 6, 10)
    expect(PLATTER_DEG_PER_SEC).toBeCloseTo(100, 10)
  })

  it('is half what the real speed would give', () => {
    expect(PLATTER_DEG_PER_SEC).toBeCloseTo((LP_RPM * 6) / 2, 10)
  })
})

describe('the arm sweep', () => {
  it('lands on the 22 degrees the spec fixes', () => {
    // Derived from the groove radii and the two arm lengths, not written down.
    // Spec section 10 fixes the sweep, so growing the disc or changing either
    // length silently breaks it — this is the guard.
    expect(ARM_SWEEP_DEG).toBeCloseTo(22, 1)
  })

  it('rests on the geometry that produces it', () => {
    expect(TONEARM.PIVOT_TO_SPINDLE).toBeCloseTo(TONEARM.EFFECTIVE_LENGTH, 10)
    expect(RECORD.GROOVE_OUTER).toBeGreaterThan(RECORD.GROOVE_INNER)
    expect(RECORD.GROOVE_OUTER).toBeLessThan(RECORD.RADIUS)
  })
})
