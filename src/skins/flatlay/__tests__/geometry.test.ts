import { describe, expect, it } from 'vitest'

import { ARM as CORE_ARM } from '../../../core/contract.js'
import {
  ARM,
  ARM_LOCAL,
  ARM_REACH,
  ARM_SOLUTION,
  armAngleAtPoint,
  armBearingDeg,
  BACK_SHIFT,
  BOARD_OFFSET,
  BOX,
  COMPOSITION_RIGHT_X,
  LAYOUT_BACK,
  LAYOUT_FRONT,
  fitBox,
  GROOVE,
  PIVOT,
  PIVOT_BEARING_DEG,
  RECORD,
  RECORD_CENTER_X,
  RECORD_HIDDEN_CENTER_X,
  RECORD_TRAVEL,
  SLEEVE,
  solveArm,
  SWAP,
  SWAP_CLEARANCE,
  STYLUS_OFFSET_DEG,
  stylusAt,
  TUCK_FRACTION,
  TUCK_FRACTION_BACK,
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
  it('tucks exactly TUCK_FRACTION of the record behind the sleeve', () => {
    const covered = SLEEVE.RIGHT_EDGE_X - (RECORD_CENTER_X - RECORD.RADIUS)
    expect(covered / (RECORD.RADIUS * 2)).toBeCloseTo(TUCK_FRACTION, 10)
  })

  it('puts the spindle on the sleeve’s edge, which is what half an overlap means', () => {
    // At a half the record's centre lands exactly on the sleeve's right edge.
    // Worth pinning: it is the one place the two objects agree on, and it is
    // what the whole layout is measured from.
    expect(TUCK_FRACTION).toBe(0.5)
    expect(RECORD_CENTER_X).toBeCloseTo(SLEEVE.RIGHT_EDGE_X, 9)
  })

  it('covers half the disc in front and a quarter behind', () => {
    const coveredIn = (l: typeof LAYOUT_FRONT) =>
      (l.coverLeft + SLEEVE.SIZE - (l.recordCenterX - RECORD.RADIUS)) / (RECORD.RADIUS * 2)
    expect(coveredIn(LAYOUT_FRONT)).toBeCloseTo(TUCK_FRACTION, 9)
    expect(coveredIn(LAYOUT_BACK)).toBeCloseTo(TUCK_FRACTION_BACK, 9)
    expect(TUCK_FRACTION_BACK).toBeLessThan(TUCK_FRACTION)
  })

  it('centres both arrangements, which is what makes the move symmetrical', () => {
    for (const layout of [LAYOUT_FRONT, LAYOUT_BACK]) {
      expect(layout.coverLeft + layout.width / 2).toBeCloseTo(BOX.WIDTH / 2, 9)
    }
    // Equal and opposite: the cover gives up exactly what the record takes.
    expect(BACK_SHIFT.COVER).toBeCloseTo(-BACK_SHIFT.RECORD, 9)
    expect(BACK_SHIFT.COVER).toBeLessThan(0)
  })

  it('still clears the record at full travel, from either resting place', () => {
    // The cover has to get clear of the record where the record actually is,
    // and at the moment of the flip the record has not adjusted yet.
    const coverRightAtFullTravel = LAYOUT_FRONT.coverLeft + SLEEVE.SIZE + SWAP.COVER_SHIFT
    expect(LAYOUT_FRONT.recordCenterX - RECORD.RADIUS).toBeGreaterThan(coverRightAtFullTravel)
  })

  it('centres the whole arrangement in the design box', () => {
    // Not the two cards: the arm reaches a long way past the record, so the
    // arrangement is much wider than the sleeve and disc suggest. Centring by
    // eye on the cards left a third of the frame empty on the right.
    expect((SLEEVE.LEFT + COMPOSITION_RIGHT_X) / 2).toBeCloseTo(BOX.WIDTH / 2, 6)
  })

  it('has the armboard as its right-hand edge, not the record', () => {
    // If this ever stopped being true the centring above would be measuring
    // the wrong thing, and nothing else would notice.
    expect(COMPOSITION_RIGHT_X).toBeGreaterThan(RECORD_CENTER_X + RECORD.RADIUS)
    expect(COMPOSITION_RIGHT_X).toBeCloseTo(
      PIVOT.x + BOARD_OFFSET.x + ARM.BOARD_WIDTH / 2,
      6,
    )
  })

  it('sits the armboard under the metalwork, not under the bearing', () => {
    // The assembly is behind and beside the pivot — a counterweight has to be —
    // so a board centred on the pivot leaves it in one corner. The board is
    // offset onto the assembly instead.
    expect(BOARD_OFFSET.x).not.toBeCloseTo(0, 1)
    expect(BOARD_OFFSET.y).not.toBeCloseTo(0, 1)
    // And it still contains the pivot, or the arm would appear to float free
    // of its own mounting.
    expect(Math.abs(BOARD_OFFSET.x)).toBeLessThan(ARM.BOARD_WIDTH / 2)
    expect(Math.abs(BOARD_OFFSET.y)).toBeLessThan(ARM.BOARD_HEIGHT / 2)
  })

  it('keeps the armboard taller than it is wide', () => {
    // It reads as a disc otherwise, which is what it did at 95 square-ish.
    expect(ARM.BOARD_WIDTH).toBeLessThan(ARM.BOARD_HEIGHT)
  })

  it('hides the record completely when it is concentric with the sleeve', () => {
    expect(RECORD_HIDDEN_CENTER_X).toBe(SLEEVE.CENTER_X)
    // The record is the smaller of the two, so concentric covers it with a
    // little to spare -- as a jacket does.
    expect(RECORD.RADIUS * 2).toBeLessThan(SLEEVE.SIZE)
    const leftOfSleeve = RECORD_HIDDEN_CENTER_X - RECORD.RADIUS
    const rightOfSleeve = RECORD_HIDDEN_CENTER_X + RECORD.RADIUS
    expect(leftOfSleeve).toBeGreaterThanOrEqual(SLEEVE.LEFT - 0.001)
    expect(rightOfSleeve).toBeLessThanOrEqual(SLEEVE.RIGHT_EDGE_X + 0.001)
  })

  it('travels exactly the gap between the two centres, and clears the rest', () => {
    // Not a number: the travel is however far it is from resting to
    // concentric, and it changed the moment the record stopped being the same
    // size as its sleeve.
    expect(RECORD_TRAVEL).toBeCloseTo(RECORD_CENTER_X - SLEEVE.CENTER_X, 9)
    expect(RECORD_TRAVEL).toBeGreaterThan(0)
    const clearedAtRest = RECORD_CENTER_X + RECORD.RADIUS - SLEEVE.RIGHT_EDGE_X
    expect(clearedAtRest / (RECORD.RADIUS * 2)).toBeCloseTo(1 - TUCK_FRACTION, 10)
  })

  it('keeps the whole composition inside the design box', () => {
    expect(SLEEVE.LEFT).toBeGreaterThan(0)
    expect(SLEEVE.TOP).toBeGreaterThan(0)
    expect(SLEEVE.TOP + SLEEVE.SIZE).toBeLessThan(BOX.HEIGHT)
    expect(RECORD_CENTER_X + RECORD.RADIUS).toBeLessThan(BOX.WIDTH)
    expect(PIVOT.x + ARM.BOARD_WIDTH / 2).toBeLessThan(BOX.WIDTH)
    expect(PIVOT.y - ARM.BOARD_HEIGHT / 2).toBeGreaterThan(0)
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

  it('picks the physical branch, with the bearing off the record', () => {
    // The constraint that means something: a tonearm's bearing sits beyond the
    // rim, not over the disc. A real 12" deck puts it at about 1.38x the
    // radius; this arm is deliberately shorter than that, so the bound is the
    // rim itself rather than a figure picked to match a particular deck — the
    // arm's length is a design choice and the solve has to follow it.
    const ratio = ARM_SOLUTION.pivotDistance / RECORD.RADIUS
    expect(ARM_SOLUTION.pivotDistance).toBeGreaterThan(RECORD.RADIUS)
    expect(ratio).toBeLessThan(1.7)
    // The second root of the error function is much further out; if the solve
    // ever found it, the offset angle would be smaller than the sweep.
    expect(ARM_SOLUTION.offsetDeg).toBeGreaterThan(CORE_ARM.END_ANGLE - CORE_ARM.START_ANGLE)
  })

  it('is not the pivot the spec names, because that one cannot reach', () => {
    // The spec's own layout: pivot at (1105, 180), record centre at (576, 400)
    // — written out, because the arrangement has since been moved to centre it
    // and the absolute numbers no longer line up with anything here.
    const specDistance = Math.hypot(1105 - 576, 180 - 400)
    expect(specDistance).toBeCloseTo(573, 0)
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

describe('the card move', () => {
  it('takes the cover fully clear of the record', () => {
    // The whole point of the hold in the middle: the stacking order changes
    // while nothing overlaps, so it is never seen as a pop inside the overlap
    // band. If this goes negative the flip becomes visible.
    expect(SWAP_CLEARANCE).toBeGreaterThan(0)

    const coverRight = SLEEVE.RIGHT_EDGE_X + SWAP.COVER_SHIFT
    const recordLeft = RECORD_CENTER_X - RECORD.RADIUS
    expect(recordLeft).toBeGreaterThan(coverRight)
  })

  it('moves the cover and nothing else', () => {
    // The record stays where it is, so the arm has nothing to follow and the
    // stylus never leaves the groove it is playing. Both objects used to move,
    // because with the sleeve at the frame's left edge there was less room
    // beside it than the overlap was wide; centring the arrangement gave the
    // cover room to do the whole move itself.
    const overlap = TUCK_FRACTION * RECORD.RADIUS * 2
    expect(Math.abs(SWAP.COVER_SHIFT)).toBeGreaterThan(overlap)
    expect(Object.keys(SWAP)).not.toContain('RECORD_SHIFT')
  })

  it('keeps the cover inside the design box at full travel', () => {
    // Square on both sides of the stack now, so the travel is the whole of it
    // -- there is no rotated corner reaching further out than the edge.
    expect(SLEEVE.LEFT + SWAP.COVER_SHIFT).toBeGreaterThan(0)
  })

  it('leaves the record and the arm exactly where they were', () => {
    // Nothing to assert about travel, because there is none -- so assert the
    // thing that travel used to threaten: the arrangement after a swap is the
    // arrangement before it.
    expect(RECORD_CENTER_X).toBe(SLEEVE.RIGHT_EDGE_X - TUCK_FRACTION * RECORD.RADIUS * 2 + RECORD.RADIUS)
    expect(PIVOT.x).toBeCloseTo(
      RECORD_CENTER_X + ARM_SOLUTION.pivotDistance * Math.cos(PIVOT_BEARING_DEG * DEG),
      9,
    )
  })
})

describe('the arm and the sleeve', () => {
  const insideSleeve = (point: { x: number; y: number }) =>
    point.x >= SLEEVE.LEFT &&
    point.x <= SLEEVE.RIGHT_EDGE_X &&
    point.y >= SLEEVE.TOP &&
    point.y <= SLEEVE.TOP + SLEEVE.SIZE

  it('keeps the park entirely off the cover', () => {
    for (const point of alongArm(ARM.PARK_BEARING_DEG)) {
      expect(insideSleeve(point)).toBe(false)
    }
  })

  it('is clear of the cover over the outer half of the sweep', () => {
    for (let angle = CORE_ARM.START_ANGLE; angle <= 10; angle += 0.5) {
      expect(insideSleeve(stylusAt(angle))).toBe(false)
    }
  })

  it('crosses onto the cover as the side runs out — and by how much', () => {
    // Not a thing anyone chose. With the sleeve covering half the disc its
    // right edge *is* the record's centre, and the arm has to reach the inner
    // groove, which is near that centre — so the stylus is over the cover for
    // roughly the back half of every side. Pinned here rather than left to be
    // discovered: if the overlap or the label changes, this number moves and
    // the trade has to be looked at again.
    const dx = (angle: number) => stylusAt(angle).x - RECORD_CENTER_X
    expect(RECORD_CENTER_X).toBeCloseTo(SLEEVE.RIGHT_EDGE_X, 6)
    expect(dx(CORE_ARM.START_ANGLE)).toBeGreaterThan(0)
    expect(dx(CORE_ARM.END_ANGLE)).toBeLessThan(0)
    // How far past the cover's edge the stylus finishes.
    expect(Math.abs(dx(CORE_ARM.END_ANGLE))).toBeLessThan(RECORD.RADIUS * 0.25)
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
