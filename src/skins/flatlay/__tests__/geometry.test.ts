import { describe, expect, it } from 'vitest'

import { ARM as CORE_ARM } from '../../../core/contract.js'
import {
  ARM,
  ARM_LOCAL,
  ARM_NUDGE_X,
  ARM_REACH,
  ARM_SOLUTION,
  armAngleAtPoint,
  armBearingDeg,
  BACK_SHIFT,
  BOARD_OFFSET,
  BOX,
  COMPOSITION_RIGHT_X,
  CONTENT,
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
  SCENE_SCALE,
  SLEEVE,
  solveArm,
  SWAP,
  SWAP_REACH_LEFT,
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
    // Measured at the pivot the solve actually solved for. `ARM_NUDGE_X`
    // slides the finished arm sideways afterwards, for the composition's sake,
    // and taking it back off is what checks the solve underneath it -- this is
    // the assertion that caught an arm which could not reach the disc at all.
    const unnudged = (armAngle: number) => {
      const point = stylusAt(armAngle)
      return { x: point.x - ARM_NUDGE_X, y: point.y }
    }
    expect(distanceToRecordCentre(unnudged(CORE_ARM.START_ANGLE))).toBeCloseTo(GROOVE.OUTER, 0)
    expect(distanceToRecordCentre(unnudged(CORE_ARM.END_ANGLE))).toBeCloseTo(GROOVE.INNER, 0)
  })

  it('spends the nudge out of the lead-in, and not all of it', () => {
    // What the sideways slide costs, where it costs it. Pinned rather than
    // left to be discovered: the lead-in is the band being spent, so if the
    // nudge grows past it the stylus starts setting down on the rim.
    const start = distanceToRecordCentre(stylusAt(CORE_ARM.START_ANGLE))
    const end = distanceToRecordCentre(stylusAt(CORE_ARM.END_ANGLE))

    expect(start).toBeGreaterThan(GROOVE.OUTER)
    expect(start - GROOVE.OUTER).toBeLessThan(RECORD.LEAD_IN)
    expect(start).toBeLessThan(RECORD.RADIUS)

    // The far end barely moves: a fraction of the run-out, not the label.
    expect(end - GROOVE.INNER).toBeLessThan(RECORD.RUN_OUT)
    expect(end).toBeGreaterThan(RECORD.LABEL_RADIUS)
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
      RECORD_CENTER_X +
        ARM_SOLUTION.pivotDistance * Math.cos(PIVOT_BEARING_DEG * DEG) +
        ARM_NUDGE_X,
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

  it('stays clear of the cover across the whole sweep', () => {
    // This was the one thing in the layout nobody chose and nobody wanted.
    // With the sleeve over half the disc its right edge *is* the record's
    // centre, and the arm has to reach the inner groove, which is near that
    // centre -- so the stylus used to finish the side a whisker over the
    // jacket, drawing a needle on printed card.
    //
    // `ARM_NUDGE_X` fixed it as a side effect: the clearance it buys at the
    // rim is bought here too, and the margin at the tightest point went from
    // about -0.7px to the figure below. Asserted across the sweep rather than
    // at the ends, because the tightest angle is not necessarily either end.
    expect(RECORD_CENTER_X).toBeCloseTo(SLEEVE.RIGHT_EDGE_X, 6)

    let tightest = Infinity
    for (let angle = CORE_ARM.START_ANGLE; angle <= CORE_ARM.END_ANGLE; angle += 0.5) {
      expect(insideSleeve(stylusAt(angle))).toBe(false)
      tightest = Math.min(tightest, stylusAt(angle).x - SLEEVE.RIGHT_EDGE_X)
    }
    expect(tightest).toBeGreaterThan(0)
    // Pinned: the margin is thin, and the overlap, the label and the nudge all
    // move it. If one of them eats this, the needle is on the artwork again.
    expect(tightest).toBeGreaterThan(ARM_NUDGE_X * 0.75)
  })
})

describe('fitting the box to a window', () => {
  const SIZES = [
    [BOX.WIDTH, BOX.HEIGHT],
    [640, 520],
    [1920, 1200],
    [1100, 700],
    [2560, 900],
  ] as const

  /** Where a design-box x lands on screen. */
  const onScreen = (fit: { scale: number; x: number; y: number }) => ({
    left: fit.x + CONTENT.left * fit.scale,
    right: fit.x + CONTENT.right * fit.scale,
    top: fit.y + CONTENT.top * fit.scale,
    bottom: fit.y + CONTENT.bottom * fit.scale,
  })

  it('zooms by SCENE_SCALE at the reference size, and stays centred', () => {
    const fit = fitBox(BOX.WIDTH, BOX.HEIGHT)
    expect(fit.scale).toBe(SCENE_SCALE)
    // The box overflows on purpose, so the offsets are negative and equal on
    // both sides -- which is the whole of "centred".
    expect(fit.x).toBeCloseTo((BOX.WIDTH - BOX.WIDTH * SCENE_SCALE) / 2, 9)
    expect(fit.y).toBeCloseTo((BOX.HEIGHT - BOX.HEIGHT * SCENE_SCALE) / 2, 9)
    expect(fit.x).toBeLessThan(0)
  })

  it('scales uniformly, so the record is never an ellipse', () => {
    for (const [width, height] of SIZES) {
      const fit = fitBox(width, height)
      expect(fit.scale).toBeGreaterThan(0)
      // One axis of the *box* is filled exactly, before the zoom.
      const unzoomed = fit.scale / SCENE_SCALE
      const filled =
        Math.abs(BOX.WIDTH * unzoomed - width) < 0.001 ||
        Math.abs(BOX.HEIGHT * unzoomed - height) < 0.001
      expect(filled).toBe(true)
    }
  })

  it('keeps the arrangement on screen at every size, zoom and all', () => {
    // The box is allowed off the window; this is what is not. Both resting
    // arrangements are inside CONTENT, so this covers cover-in-front and
    // cover-behind alike.
    for (const [width, height] of SIZES) {
      const rect = onScreen(fitBox(width, height))
      expect(rect.left).toBeGreaterThanOrEqual(0)
      expect(rect.top).toBeGreaterThanOrEqual(0)
      expect(rect.right).toBeLessThanOrEqual(width + 0.001)
      expect(rect.bottom).toBeLessThanOrEqual(height + 0.001)
    }
  })

  it('has room left before the arrangement would touch the edge', () => {
    // How much bigger the scene could go. Pinned so that raising SCENE_SCALE
    // past what the composition can take fails here rather than in the window.
    const halfWidth = Math.max(BOX.WIDTH / 2 - CONTENT.left, CONTENT.right - BOX.WIDTH / 2)
    const halfHeight = Math.max(BOX.HEIGHT / 2 - CONTENT.top, CONTENT.bottom - BOX.HEIGHT / 2)
    expect(BOX.WIDTH / 2 / halfWidth).toBeGreaterThan(SCENE_SCALE)
    expect(BOX.HEIGHT / 2 / halfHeight).toBeGreaterThan(SCENE_SCALE)
  })

  it('pins the card swap leaving the window at this zoom', () => {
    // Not a thing anyone chose, and the one cost of the zoom. The cover slides
    // a clear disc-width left at the top of the swap -- further out than any
    // resting state -- and the box's left margin is not deep enough to pay for
    // that at SCENE_SCALE as well. It is on screen at rest and clipped only
    // during the move.
    //
    // The ceiling that would keep it in is about 1.08, so this is a real
    // trade, not a rounding error. Recorded here so it is a decision and not a
    // surprise: raising the zoom makes it worse, and the levers are the zoom
    // itself or letting the record share the travel.
    const fit = fitBox(BOX.WIDTH, BOX.HEIGHT)
    expect(SWAP_REACH_LEFT).toBeGreaterThan(0) // still inside the design box
    expect(fit.x + SWAP_REACH_LEFT * fit.scale).toBeLessThan(0) // but off the window
  })

  it('survives a window with no size yet', () => {
    expect(fitBox(0, 0).scale).toBe(SCENE_SCALE)
    expect(fitBox(Number.NaN, Number.NaN).scale).toBe(SCENE_SCALE)
  })
})
