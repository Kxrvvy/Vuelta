import { describe, expect, it } from 'vitest'

import { ARM as CORE_ARM } from '../../../core/contract.js'
import {
  ARM,
  ARM_LOCAL,
  ARM_REACH,
  ARM_SOLUTION,
  armAngleAtPoint,
  armBearingDeg,
  BOX,
  fitBox,
  GROOVE,
  PIVOT,
  RECORD,
  RECORD_CENTER_X,
  RECORD_HIDDEN_CENTER_X,
  RECORD_TRAVEL,
  SLEEVE,
  solveArm,
  STYLUS_OFFSET_DEG,
  stylusAt,
  TUCK_FRACTION,
} from '../geometry.js'

const DEG = Math.PI / 180

function distanceToRecordCentre(point: { x: number; y: number }, centreX = RECORD_CENTER_X): number {
  return Math.hypot(point.x - centreX, point.y - RECORD.CENTER_Y)
}

/** Points along the arm from the pivot to the stylus, at a given bearing. */
function alongArm(bearingDeg: number, samples = 40): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = []
  for (let index = 0; index <= samples; index += 1) {
    const reach = (ARM_REACH * index) / samples
    points.push({
      x: PIVOT.x + reach * Math.cos(bearingDeg * DEG),
      y: PIVOT.y + reach * Math.sin(bearingDeg * DEG),
    })
  }
  return points
}

describe('the flat-lay layout', () => {
  it('tucks exactly 35% of the record behind the sleeve', () => {
    const covered = SLEEVE.RIGHT_EDGE_X - (RECORD_CENTER_X - RECORD.RADIUS)
    expect(covered / (RECORD.RADIUS * 2)).toBeCloseTo(TUCK_FRACTION, 10)
  })

  it('puts the record centre where the derivation lands, not where the table says', () => {
    // The spec's own table says 700, which would be a 7% overlap. See the
    // header note in geometry.ts.
    expect(RECORD_CENTER_X).toBeCloseTo(576, 6)
  })

  it('hides the record completely when it is concentric with the sleeve', () => {
    expect(RECORD_HIDDEN_CENTER_X).toBe(SLEEVE.CENTER_X)
    // Both are 440 across, so concentric really is fully hidden.
    expect(RECORD.RADIUS * 2).toBe(SLEEVE.SIZE)
    const leftOfSleeve = RECORD_HIDDEN_CENTER_X - RECORD.RADIUS
    const rightOfSleeve = RECORD_HIDDEN_CENTER_X + RECORD.RADIUS
    expect(leftOfSleeve).toBeGreaterThanOrEqual(SLEEVE.LEFT - 0.001)
    expect(rightOfSleeve).toBeLessThanOrEqual(SLEEVE.RIGHT_EDGE_X + 0.001)
  })

  it('travels 286px, and §9 clears 65% of the disc', () => {
    expect(RECORD_TRAVEL).toBeCloseTo(286, 6)
    const clearedAtRest = RECORD_CENTER_X + RECORD.RADIUS - SLEEVE.RIGHT_EDGE_X
    expect(clearedAtRest / (RECORD.RADIUS * 2)).toBeCloseTo(1 - TUCK_FRACTION, 10)
  })

  it('keeps the whole composition inside the design box', () => {
    expect(SLEEVE.LEFT).toBeGreaterThan(0)
    expect(SLEEVE.TOP).toBeGreaterThan(0)
    expect(SLEEVE.TOP + SLEEVE.SIZE).toBeLessThan(BOX.HEIGHT)
    expect(RECORD_CENTER_X + RECORD.RADIUS).toBeLessThan(BOX.WIDTH)
    expect(PIVOT.x + ARM.BEARING_DIAMETER / 2).toBeLessThan(BOX.WIDTH)
    expect(PIVOT.y - ARM.BEARING_DIAMETER / 2).toBeGreaterThan(0)
  })
})

describe('the arm solve', () => {
  it('lands armAngle 0 on the outer groove and 22 on the inner, within a pixel', () => {
    expect(distanceToRecordCentre(stylusAt(CORE_ARM.START_ANGLE))).toBeCloseTo(GROOVE.OUTER, 0)
    expect(distanceToRecordCentre(stylusAt(CORE_ARM.END_ANGLE))).toBeCloseTo(GROOVE.INNER, 0)
  })

  it('sweeps inward monotonically across the whole band', () => {
    let previous = Infinity
    for (let angle = CORE_ARM.START_ANGLE; angle <= CORE_ARM.END_ANGLE; angle += 0.5) {
      const radius = distanceToRecordCentre(stylusAt(angle))
      expect(radius).toBeLessThan(previous)
      previous = radius
    }
  })

  it('never puts the stylus on the label or past the rim', () => {
    for (let angle = CORE_ARM.START_ANGLE; angle <= CORE_ARM.END_ANGLE; angle += 0.5) {
      const radius = distanceToRecordCentre(stylusAt(angle))
      expect(radius).toBeGreaterThan(RECORD.LABEL_RADIUS)
      expect(radius).toBeLessThan(RECORD.RADIUS)
    }
  })

  it('picks the physical branch, near a real deck’s proportions', () => {
    // A real 12" deck: pivot at ~1.38x the disc radius, arm ~1.51x it.
    const ratio = ARM_SOLUTION.pivotDistance / RECORD.RADIUS
    expect(ratio).toBeGreaterThan(1.2)
    expect(ratio).toBeLessThan(1.7)
    // The second root of the error function is much further out; if the solve
    // ever found it, the offset angle would be smaller than the sweep.
    expect(ARM_SOLUTION.offsetDeg).toBeGreaterThan(CORE_ARM.END_ANGLE - CORE_ARM.START_ANGLE)
  })

  it('is not the pivot the spec names, because that one cannot reach', () => {
    const specDistance = Math.hypot(1105 - RECORD_CENTER_X, 180 - RECORD.CENTER_Y)
    // The closest the stylus could come to the centre from there.
    expect(specDistance - ARM_REACH).toBeGreaterThan(RECORD.RADIUS)
  })

  it('puts the drawn headshell tip exactly where the groove maths says', () => {
    // The tube is rotated by `armBearingDeg`; the headshell then bends 20° off
    // it. The tip of that bend must be the same point as `stylusAt`, or the
    // picture and the maths disagree by most of the run-out band.
    for (const angle of [0, 7, 15, 22]) {
      const tube = armBearingDeg(angle) * DEG
      const bend = {
        x: PIVOT.x + ARM_LOCAL.bend.x * Math.cos(tube),
        y: PIVOT.y + ARM_LOCAL.bend.x * Math.sin(tube),
      }
      const headshell = tube + ARM.HEADSHELL_OFFSET_DEG * DEG
      const tip = {
        x: bend.x + ARM.HEADSHELL_LENGTH * Math.cos(headshell),
        y: bend.y + ARM.HEADSHELL_LENGTH * Math.sin(headshell),
      }
      const stylus = stylusAt(angle)
      expect(tip.x).toBeCloseTo(stylus.x, 6)
      expect(tip.y).toBeCloseTo(stylus.y, 6)
    }
  })

  it('round-trips a point back to the angle that points at it', () => {
    for (const angle of [0, 4.5, 11, 18, 22]) {
      expect(armAngleAtPoint(stylusAt(angle))).toBeCloseTo(angle, 6)
    }
  })

  it('solves for other geometries too', () => {
    const solution = solveArm({ reach: 300, outer: 180, inner: 80, sweepDeg: 22 })
    const radius = (alpha: number) =>
      Math.sqrt(
        solution.pivotDistance ** 2 +
          300 ** 2 -
          2 * solution.pivotDistance * 300 * Math.cos(alpha * DEG),
      )
    expect(radius(solution.offsetDeg)).toBeCloseTo(180, 6)
    expect(radius(solution.offsetDeg - 22)).toBeCloseTo(80, 6)
  })
})

describe('the park', () => {
  it('points straight down', () => {
    expect(ARM.PARK_BEARING_DEG).toBe(90)
  })

  it('is entirely clear of the disc — stylus and tube alike', () => {
    // §11's check, and the reason the pivot had to move: at the spec's pivot
    // this is not even askable, because the arm cannot reach the record.
    for (const point of alongArm(ARM.PARK_BEARING_DEG)) {
      expect(distanceToRecordCentre(point)).toBeGreaterThan(RECORD.RADIUS)
    }
    const parkedStylus = {
      x: PIVOT.x + ARM_REACH * Math.cos((ARM.PARK_BEARING_DEG + STYLUS_OFFSET_DEG) * DEG),
      y: PIVOT.y + ARM_REACH * Math.sin((ARM.PARK_BEARING_DEG + STYLUS_OFFSET_DEG) * DEG),
    }
    expect(distanceToRecordCentre(parkedStylus)).toBeGreaterThan(RECORD.RADIUS)
  })

  it('stays clear of the disc while it is sliding out, too', () => {
    // The record moves and the arm does not, so the park has to clear the
    // record at every point of §9's travel.
    for (let step = 0; step <= 1; step += 0.05) {
      const centreX = RECORD_HIDDEN_CENTER_X + RECORD_TRAVEL * step
      for (const point of alongArm(ARM.PARK_BEARING_DEG)) {
        expect(distanceToRecordCentre(point, centreX)).toBeGreaterThan(RECORD.RADIUS)
      }
    }
  })

  it('is well away from the playing band, so the lift reads as a move', () => {
    const atEnd = armBearingDeg(CORE_ARM.END_ANGLE)
    expect(Math.abs(atEnd - ARM.PARK_BEARING_DEG)).toBeGreaterThan(20)
  })
})

describe('the arm and the sleeve', () => {
  it('never overlap, anywhere in the band or at the park', () => {
    const insideSleeve = (point: { x: number; y: number }) =>
      point.x >= SLEEVE.LEFT &&
      point.x <= SLEEVE.RIGHT_EDGE_X &&
      point.y >= SLEEVE.TOP &&
      point.y <= SLEEVE.TOP + SLEEVE.SIZE

    for (let angle = CORE_ARM.START_ANGLE; angle <= CORE_ARM.END_ANGLE; angle += 0.5) {
      for (const point of alongArm(armBearingDeg(angle))) {
        expect(insideSleeve(point)).toBe(false)
      }
    }
    for (const point of alongArm(ARM.PARK_BEARING_DEG)) {
      expect(insideSleeve(point)).toBe(false)
    }
  })
})

describe('fitting the box to a window', () => {
  it('is exact at the reference size', () => {
    const fit = fitBox(BOX.WIDTH, BOX.HEIGHT)
    expect(fit.scale).toBe(1)
    expect(fit.x).toBe(0)
    expect(fit.y).toBe(0)
  })

  it('scales uniformly and centres, so the record is never an ellipse', () => {
    for (const [width, height] of [
      [640, 520],
      [1920, 1200],
      [1100, 700],
      [2560, 900],
    ] as const) {
      const fit = fitBox(width, height)
      expect(fit.scale).toBeGreaterThan(0)
      expect(BOX.WIDTH * fit.scale).toBeLessThanOrEqual(width + 0.001)
      expect(BOX.HEIGHT * fit.scale).toBeLessThanOrEqual(height + 0.001)
      expect(fit.x).toBeGreaterThanOrEqual(0)
      expect(fit.y).toBeGreaterThanOrEqual(0)
      // One of the two axes is filled exactly.
      const filled =
        Math.abs(BOX.WIDTH * fit.scale - width) < 0.001 ||
        Math.abs(BOX.HEIGHT * fit.scale - height) < 0.001
      expect(filled).toBe(true)
    }
  })

  it('survives a window with no size yet', () => {
    expect(fitBox(0, 0).scale).toBe(1)
    expect(fitBox(Number.NaN, Number.NaN).scale).toBe(1)
  })
})
