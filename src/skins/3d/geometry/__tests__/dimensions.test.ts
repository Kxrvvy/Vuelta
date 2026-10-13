import { describe, expect, it } from 'vitest'

import { LP_RPM, PLATTER_RPM } from '../../../../core/contract.js'
import { ARM } from '../../../../core/contract.js'
import {
  ARM_BASE_YAW_DEG,
  ARM_SWEEP_DEG,
  DISPLAY,
  PLATTER,
  PLATTER_DEG_PER_SEC,
  PLINTH,
  RECORD,
  RECORD_SURFACE_Y,
  SLEEVE,
  SLEEVE_IN_X,
  SLEEVE_OUT_X,
  SLEEVE_Y,
  sleeveCoverage,
  TONEARM,
  TONEARM_PIVOT,
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

/**
 * The counter sits in the only clear space on the machine, and it is a tight
 * fit on two sides. Both clearances are held here because the things that
 * would eat them - a bigger record, a wider well, a larger panel - live
 * nowhere near this file.
 */
describe('the deck counter fits where it is put', () => {
  /** Radius of the recessed well the platter sits in, from Cabinet.tsx. */
  const WELL_RADIUS = PLATTER.RADIUS + 0.008

  const corners = () => {
    // Spindle-relative, which is the frame the well clearance lives in.
    const x = DISPLAY.CENTER_X
    const out: { x: number; z: number }[] = []
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        out.push({ x: x + (sx * DISPLAY.WIDTH) / 2, z: DISPLAY.CENTER_Z + (sz * DISPLAY.DEPTH) / 2 })
      }
    }
    return out
  }

  it('clears the platter well at every corner', () => {
    for (const { x, z } of corners()) {
      expect(Math.hypot(x, z)).toBeGreaterThan(WELL_RADIUS)
    }
  })

  it('keeps real daylight from the well, not a rounding error', () => {
    const nearest = Math.min(...corners().map(({ x, z }) => Math.hypot(x, z)))
    expect(nearest - WELL_RADIUS).toBeGreaterThan(0.0015)
  })

  it('stays out of the tonearm, across the whole of its travel', () => {
    // The closest the arm ever comes is the stylus parked at REST_ANGLE,
    // which swings furthest forward. Checked over the full sweep rather than
    // at one angle, because which end is nearest is not obvious.
    const base = (ARM_BASE_YAW_DEG * Math.PI) / 180
    for (let angle = ARM.REST_ANGLE; angle <= ARM.END_ANGLE; angle += 0.5) {
      const bearing = Math.PI - base + (angle * Math.PI) / 180
      const stylus = {
        x: TONEARM_PIVOT.x + Math.cos(bearing) * TONEARM.EFFECTIVE_LENGTH,
        z: TONEARM_PIVOT.z + Math.sin(bearing) * TONEARM.EFFECTIVE_LENGTH,
      }
      // The panel sits entirely to the right of everything the arm reaches.
      expect(stylus.x).toBeLessThan(DISPLAY.CENTER_X - DISPLAY.WIDTH / 2)
    }
  })

  it('stays clear of the arm pivot and its counterweight', () => {
    const nearest = Math.min(
      ...corners().map(({ x, z }) => Math.hypot(x - TONEARM_PIVOT.x, z - TONEARM_PIVOT.z)),
    )
    expect(nearest).toBeGreaterThan(TONEARM.COUNTERWEIGHT_OFFSET + 0.02)
  })

  it('stays inside the satin deck, not out on the wood border', () => {
    // The deck inset is 42mm smaller than the plinth on both axes - see the
    // top deck mesh in Cabinet.tsx.
    const halfW = (PLINTH.WIDTH - 0.042) / 2
    const halfD = (PLINTH.DEPTH - 0.042) / 2
    for (const { x, z } of corners()) {
      expect(x).toBeGreaterThan(PLINTH.CENTER_X - halfW)
      expect(x).toBeLessThan(PLINTH.CENTER_X + halfW)
      expect(Math.abs(z)).toBeLessThan(halfD)
    }
  })

  it('sits at the front right, which reads as lower right on screen', () => {
    // The overhead camera looks down -z, so +z projects toward the bottom of
    // the frame and +x to the right.
    expect(DISPLAY.CENTER_X).toBeGreaterThan(0)
    expect(DISPLAY.CENTER_Z).toBeGreaterThan(0)
  })
})

describe('the sleeve, and the record sliding in and out of it', () => {
  it('is a real jacket: square, and larger than the record it holds', () => {
    expect(SLEEVE.SIZE).toBeGreaterThan(RECORD.RADIUS * 2)
    // A 12 inch jacket is 315mm and a 12 inch record 302mm. Much more than
    // that and it stops reading as a sleeve for this record.
    expect(SLEEVE.SIZE - RECORD.RADIUS * 2).toBeLessThan(0.02)
  })

  it('clears the record completely when the record is out', () => {
    // The resting state, and the whole point of it: the disc is whole and
    // turning, with nothing lying across it.
    expect(sleeveCoverage(SLEEVE_OUT_X)).toBe(0)
    expect(SLEEVE_OUT_X + SLEEVE.SIZE / 2).toBeLessThan(-RECORD.RADIUS)
  })

  it('covers about three fifths of the disc when the record is tucked in', () => {
    // This ratio is the look. It is also what a later change to SLEEVE.SIZE
    // would move without anything else noticing.
    expect(sleeveCoverage(SLEEVE_IN_X)).toBeCloseTo(0.6, 1)
  })

  it('slides right to tuck, so the record never leaves the arm', () => {
    expect(SLEEVE_IN_X).toBeGreaterThan(SLEEVE_OUT_X)
  })

  it('lies in the record plane, just above it', () => {
    // Above, because the record comes out from inside the sleeve: where they
    // overlap it is the sleeve's front panel you see.
    expect(SLEEVE_Y).toBeGreaterThan(RECORD_SURFACE_Y)
    expect(SLEEVE_Y - RECORD_SURFACE_Y).toBeLessThan(0.01)
  })
})
