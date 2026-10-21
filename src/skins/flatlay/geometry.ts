/**
 * The flat-lay's layout and arm geometry.
 *
 * Everything is in **design pixels** inside a fixed 1280x800 box, which is the
 * size the spec is written against. `FlatLay` scales that box to the window
 * with one transform, so every number here can be taken literally -- shadow
 * offsets, hairlines and all -- and the composition can never reflow into
 * something the spec does not describe.
 *
 * Pure: no DOM, no React. The arm solve below has a test.
 *
 * Two numbers differ from the spec, both because the spec contradicts itself:
 *
 * 1. **The record's centre.** The layout table puts it at x 700, which leaves
 *    a 30px overlap with the sleeve -- 7% of the diameter. The same section
 *    asks for the record's "left ~35%" to sit behind the sleeve, which needs
 *    154px. The qualitative rule wins, because "half-pulled-out of the jacket"
 *    is the stated signature of the layout and §9's slide is measured from it,
 *    so the centre is *derived* from `TUCK_FRACTION` instead of written down.
 *    It lands at x 576.
 *
 * 2. **The pivot.** At the spec's (1105, 180) the pivot is 573px from the
 *    record centre, and a 290px tube plus a 46px headshell reaches 336px --
 *    so the stylus can come no closer to the centre than 573-336 = 237px, and
 *    the disc's radius is 220. The arm never touches the record at all.
 *    Solving with the pivot fixed demands a 480px arm, which is not the slim
 *    machined thing §6 describes. So the arm keeps its length and the pivot
 *    moves in: a real 12" deck mounts its bearing at about 1.38x the disc
 *    radius from the spindle with an effective length of about 1.51x it, and
 *    the spec's own arm is already almost exactly that length. `solveArm`
 *    finds the distance that puts armAngle 0 on the outer groove and 22 on the
 *    inner, which is the only thing that actually has to be true.
 */

/** The box every number below is measured in. */
export const BOX = { WIDTH: 1280, HEIGHT: 800 } as const

const DEG = Math.PI / 180

export const SLEEVE = {
  SIZE: 440,
  /**
   * Solved, not placed — see `SLEEVE_LEFT` below, which centres the whole
   * arrangement in the box. A getter because that solve needs the arm, and
   * the arm needs these dimensions.
   */
  get LEFT() {
    return SLEEVE_LEFT
  },
  /** Vertically centred. */
  get TOP() {
    return (BOX.HEIGHT - this.SIZE) / 2
  },
  get CENTER_X() {
    return this.LEFT + this.SIZE / 2
  },
  get CENTER_Y() {
    return BOX.HEIGHT / 2
  },
  get RIGHT_EDGE_X() {
    return this.LEFT + this.SIZE
  },
  /** §3: "Corner radius 2px. Not 0, not 12." */
  CORNER_RADIUS: 2,
} as const

/**
 * How much of the record's diameter the sleeve covers when it is at rest.
 *
 * The signature of the layout, and the one number everything else is measured
 * from: half the disc is behind the jacket, and the same half stays behind it
 * whichever of the two is on top. At a half the record's centre — and so the
 * spindle — sits exactly on the sleeve's right edge.
 *
 * It was 0.35, which is §9's "~65% clears the sleeve edge". The cost of a half
 * is the label: at 0.35 a sliver of it was behind the cover, at 0.5 it is the
 * whole left half, so the title and artist are only fully legible with the
 * record in front.
 */
export const TUCK_FRACTION = 0.5

/**
 * And how much it covers once it is behind the record: a quarter.
 *
 * The cover does not sit in the same place on both sides of the stack. In
 * front it hides half the disc, which is the arrangement the layout is drawn
 * around; behind, it draws back to a quarter, so the record it is now under
 * is mostly clear of it and the label is readable.
 *
 * Both arrangements are centred in the box, which is what makes the move
 * symmetrical: the widths differ by half the disc's radius, so the cover goes
 * left by half of that and the record and arm go right by the same.
 */
export const TUCK_FRACTION_BACK = 0.25

/**
 * How much smaller the record is than the jacket it comes out of.
 *
 * A real 12" LP is 302mm in a 315mm sleeve — about 4% under. They were exactly
 * the same size here, which is the one proportion that gives the trick away:
 * a disc flush with its jacket does not look like it could ever go back in.
 *
 * The whole record scales, not just its rim, so the label, the hole and the
 * two smooth lands keep the proportions they were drawn with.
 */
const RECORD_SCALE = 0.95

export const RECORD = {
  RADIUS: (SLEEVE.SIZE / 2) * RECORD_SCALE,
  /**
   * §5's label was ⌀165 — 37% of the disc. A pressing's label is a good deal
   * larger than that, nearly half the diameter, and at 37% there was not much
   * room on it for anything but the title.
   */
  LABEL_RADIUS: ((440 / 2) * RECORD_SCALE) * 0.45,
  /** §5: spindle hole ⌀12, punched through to the paper. */
  SPINDLE_RADIUS: 6 * RECORD_SCALE,
  /** §4: a wider smooth band at the rim, with no ring texture. */
  LEAD_IN: 14 * RECORD_SCALE,
  /** §4: smooth band just outside the label. */
  RUN_OUT: 10 * RECORD_SCALE,
  /**
   * The spacing of the groove rings, in design pixels.
   *
   * The design asked for ~2px, "felt, not counted", and what shipped could
   * not be seen at all. Measured rather than guessed, against the real
   * stylesheet: the cause was mostly *contrast* — the rings were nine levels
   * off the base, which at this size is a grey wash — and only partly the
   * spacing.
   *
   * The spacing still matters. The box is scaled to the window, about 0.945
   * at the reference size, so a 2px period lands two sub-pixel bands on the
   * grid and they beat against it: rings resolve, but unevenly, in merged
   * runs. At 4 each band clears a device pixel and the spacing stays regular.
   *
   * A real LP's grooves are far finer than either figure, and far finer than
   * a screen can draw. Past a point, accuracy is just grey.
   */
  GROOVE_PERIOD: 4,
  CENTER_Y: BOX.HEIGHT / 2,
} as const

/** The playable band, as radii from the record's centre. */
export const GROOVE = {
  OUTER: RECORD.RADIUS - RECORD.LEAD_IN,
  INNER: RECORD.LABEL_RADIUS + RECORD.RUN_OUT,
} as const

export const ARM = {
  /** §6: slim brushed aluminium cylinder. */
  TUBE_LENGTH: 290,
  TUBE_WIDTH: 9,
  /** §6: angled ~20° off the tube axis. The arm visibly bends here. */
  HEADSHELL_LENGTH: 46,
  HEADSHELL_WIDTH: 26,
  HEADSHELL_OFFSET_DEG: 20,
  /** §6: a hairline circle, the only visible mechanism in the scene. */
  BEARING_DIAMETER: 95,
  HOUSING_WIDTH: 46,
  HOUSING_HEIGHT: 38,
  COUNTERWEIGHT: 30,
  STYLUS_SIZE: 3,
  /**
   * Parked straight down from the pivot -- 6 o'clock, as §6 requires.
   *
   * A pose, not an `armAngle`. The groove band is a solved arc and the park is
   * nowhere on it; the skin eases between the two, which is what lets
   * `ARM.REST_ANGLE` in core keep meaning "parked" without being re-tuned.
   */
  PARK_BEARING_DEG: 90,
} as const

/**
 * Where the stylus sits in the arm's own frame: along the tube, then out along
 * the headshell, which §6 angles 20° off the tube axis.
 *
 * The bend has to be in the geometry and not only in the drawing. A headshell
 * rotated for looks puts its tip 16px off the arm's axis, and 16px at this
 * scale is most of the run-out band -- the stylus would be drawn somewhere the
 * groove maths says it is not.
 */
const STYLUS_LOCAL = {
  x: ARM.TUBE_LENGTH + ARM.HEADSHELL_LENGTH * Math.cos(ARM.HEADSHELL_OFFSET_DEG * DEG),
  y: ARM.HEADSHELL_LENGTH * Math.sin(ARM.HEADSHELL_OFFSET_DEG * DEG),
} as const

/** Pivot to stylus. Shorter than tube + headshell, because of the bend. */
export const ARM_REACH = Math.hypot(STYLUS_LOCAL.x, STYLUS_LOCAL.y)

/**
 * How far the stylus sits off the tube's own axis, in degrees.
 *
 * The tube and the stylus therefore point in slightly different directions:
 * the solve below is about the *stylus*, because that is what has to land in
 * the groove, while the SVG rotates the *tube*.
 */
export const STYLUS_OFFSET_DEG = (Math.atan2(STYLUS_LOCAL.y, STYLUS_LOCAL.x) * 180) / Math.PI

/**
 * Direction from the record's centre to the pivot, as the spec draws it:
 * up and to the right. Only the *distance* is solved; this bearing is kept.
 *
 * A literal rather than `atan2` of the spec's own pivot against the record's
 * centre, which is how it was first worked out: the centre is now solved from
 * this bearing, so measuring the bearing from the centre would be circular.
 * It is the angle from (576, 400) to the spec's (1105, 180).
 */
export const PIVOT_BEARING_DEG = -22.58

/** Radius from the record's centre that a stylus at `alphaDeg` off the pivot line reaches. */
function radiusAt(pivotDistance: number, reach: number, alphaDeg: number): number {
  const a = alphaDeg * DEG
  return Math.sqrt(
    pivotDistance * pivotDistance +
      reach * reach -
      2 * pivotDistance * reach * Math.cos(a),
  )
}

/** The offset angle that puts the stylus on `outer`, for a given pivot distance. */
function offsetForOuter(pivotDistance: number, reach: number, outer: number): number {
  const cos =
    (pivotDistance * pivotDistance + reach * reach - outer * outer) /
    (2 * pivotDistance * reach)
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI
}

export type ArmSolution = {
  /** Pivot to record centre. */
  pivotDistance: number
  /** Angle at the pivot between the pivot-centre line and the arm at `START_ANGLE`. */
  offsetDeg: number
}

/**
 * Find the pivot distance at which the sweep lands on the groove band at both
 * ends: `offsetDeg` puts the stylus on `outer`, and `offsetDeg - sweepDeg`
 * puts it on `inner`.
 *
 * Bisected rather than solved in closed form, the way `fitCamera` bisects its
 * look-at: the error function has a second root further out, where the arm has
 * swung past the pivot-centre line and the radius grows again, and that root
 * is not a turntable. Scanning for the first sign change picks the physical
 * branch and leaves no doubt about which one was found.
 */
export function solveArm(options: {
  reach: number
  outer: number
  inner: number
  sweepDeg: number
}): ArmSolution {
  const { reach, outer, inner, sweepDeg } = options
  const error = (distance: number) =>
    radiusAt(distance, reach, offsetForOuter(distance, reach, outer) - sweepDeg) - inner

  // The physical branch. A real deck sits around 1.4-1.5x the outer groove.
  const from = outer * 1.02
  const to = outer * 2
  const steps = 240
  const stride = (to - from) / steps

  let lo = from
  let loError = error(lo)
  let hi = 0
  let found = false

  for (let index = 1; index <= steps; index += 1) {
    const at = from + stride * index
    const atError = error(at)
    if (loError <= 0 !== atError <= 0) {
      hi = at
      found = true
      break
    }
    lo = at
    loError = atError
  }

  if (!found) {
    throw new Error('solveArm: no pivot distance puts the sweep on the groove band')
  }

  for (let index = 0; index < 60; index += 1) {
    const mid = (lo + hi) / 2
    if (error(mid) <= 0 === loError <= 0) lo = mid
    else hi = mid
  }

  const pivotDistance = (lo + hi) / 2
  return {
    pivotDistance,
    offsetDeg: offsetForOuter(pivotDistance, reach, outer),
  }
}

export const ARM_SOLUTION = solveArm({
  reach: ARM_REACH,
  outer: GROOVE.OUTER,
  inner: GROOVE.INNER,
  // ARM.END_ANGLE - ARM.START_ANGLE from core, written out rather than
  // imported: this module is the skin's own geometry and must not depend on
  // the contract to compute a shape.
  sweepDeg: 22,
})

/** How far right of the record's centre the pivot sits. */
const PIVOT_DX = ARM_SOLUTION.pivotDistance * Math.cos(PIVOT_BEARING_DEG * DEG)

export type Layout = {
  /** The sleeve's left edge. */
  coverLeft: number
  recordCenterX: number
  /** Sleeve's left edge to the outside of the bearing circle. */
  width: number
}

/**
 * Where everything goes for a given overlap, with the arrangement centred.
 *
 * The width runs from the sleeve's left edge to the outside of the bearing
 * circle — its rightmost point, further out than either the record's rim or
 * the counterweight at any angle — and is independent of where the thing is
 * put, which is what lets this solve for a position rather than be told one.
 *
 * The sleeve used to sit at x=70, chosen by eye against the two cards. The arm
 * reaches a long way past the record, so the arrangement is much wider than
 * the cards suggest and that left a third of the frame empty on the right.
 */
function layoutFor(tuck: number): Layout {
  const recordFromCoverLeft = SLEEVE.SIZE - tuck * RECORD.RADIUS * 2 + RECORD.RADIUS
  const width = recordFromCoverLeft + PIVOT_DX + ARM.BEARING_DIAMETER / 2
  const coverLeft = (BOX.WIDTH - width) / 2
  return { coverLeft, recordCenterX: coverLeft + recordFromCoverLeft, width }
}

/** The cover in front, hiding half the disc. The layout everything is drawn at. */
export const LAYOUT_FRONT = layoutFor(TUCK_FRACTION)

/** The cover behind, drawn back to a quarter. */
export const LAYOUT_BACK = layoutFor(TUCK_FRACTION_BACK)

/**
 * What each object does when the cover goes behind, relative to where it is
 * drawn. Equal and opposite, because both arrangements are centred.
 */
export const BACK_SHIFT = {
  COVER: LAYOUT_BACK.coverLeft - LAYOUT_FRONT.coverLeft,
  /** The arm travels with the record, so the stylus keeps its groove. */
  RECORD: LAYOUT_BACK.recordCenterX - LAYOUT_FRONT.recordCenterX,
} as const

const SLEEVE_LEFT = LAYOUT_FRONT.coverLeft

/**
 * Where the record sits at rest, derived so that exactly `TUCK_FRACTION` of it
 * is behind the sleeve.
 */
export const RECORD_CENTER_X = LAYOUT_FRONT.recordCenterX

/**
 * Where the record sits when it is completely hidden.
 *
 * Concentric with the sleeve, which now covers it with a little to spare --
 * the record is 5% the smaller of the two.
 */
export const RECORD_HIDDEN_CENTER_X = SLEEVE.CENTER_X

/** §9's travel: 286px. */
export const RECORD_TRAVEL = RECORD_CENTER_X - RECORD_HIDDEN_CENTER_X

/** The outside of the bearing circle: the arrangement's right-hand edge. */
export const COMPOSITION_RIGHT_X = RECORD_CENTER_X + PIVOT_DX + ARM.BEARING_DIAMETER / 2

export const PIVOT = {
  x: RECORD_CENTER_X + ARM_SOLUTION.pivotDistance * Math.cos(PIVOT_BEARING_DEG * DEG),
  y: RECORD.CENTER_Y + ARM_SOLUTION.pivotDistance * Math.sin(PIVOT_BEARING_DEG * DEG),
} as const

/** Screen bearing from the pivot to the record's centre. */
const PIVOT_TO_CENTER_DEG =
  (Math.atan2(RECORD.CENTER_Y - PIVOT.y, RECORD_CENTER_X - PIVOT.x) * 180) / Math.PI

/**
 * Where the *stylus* points for a given `armAngle`, as a screen bearing.
 *
 * `armAngle` 0 is the outer groove and 22 the inner, so the arm closes on the
 * pivot-centre line as the track plays -- which is the whole of the mapping.
 */
export function stylusBearingDeg(armAngle: number): number {
  return PIVOT_TO_CENTER_DEG - ARM_SOLUTION.offsetDeg + armAngle
}

/**
 * Where the *tube* points — what the SVG rotates.
 *
 * Offset from the stylus by the headshell's bend, so that rotating the tube by
 * this much lands the headshell's tip exactly on the groove.
 */
export function armBearingDeg(armAngle: number): number {
  return stylusBearingDeg(armAngle) - STYLUS_OFFSET_DEG
}

/** Where the stylus sits for a given `armAngle`. */
export function stylusAt(armAngle: number): { x: number; y: number } {
  const bearing = stylusBearingDeg(armAngle) * DEG
  return {
    x: PIVOT.x + ARM_REACH * Math.cos(bearing),
    y: PIVOT.y + ARM_REACH * Math.sin(bearing),
  }
}

/**
 * The inverse, for the drag: which `armAngle` points the arm at this point.
 *
 * Unclamped on purpose -- `clampToGroove` in `core/armMath.ts` owns the band,
 * and the drag needs the raw value to blend from where it was grabbed.
 */
export function armAngleAtPoint(point: { x: number; y: number }): number {
  const bearing = (Math.atan2(point.y - PIVOT.y, point.x - PIVOT.x) * 180) / Math.PI
  return bearing - PIVOT_TO_CENTER_DEG + ARM_SOLUTION.offsetDeg
}

/** The arm's parts in its own frame, for the SVG to draw along +x. */
export const ARM_LOCAL = {
  stylus: STYLUS_LOCAL,
  /** Where the tube ends and the headshell begins. */
  bend: { x: ARM.TUBE_LENGTH, y: 0 },
  /** The counterweight sits behind the pivot, opposite the stylus. */
  counterweightX: -(ARM.HOUSING_WIDTH / 2 + ARM.COUNTERWEIGHT / 2),
} as const

/**
 * The card move: how far the cover travels while it changes places in the
 * stack.
 *
 * **Only the cover moves.** It slides clear of the record, trades places with
 * it out there where nothing is overlapping, and slides home; the record does
 * not stir, and the tonearm therefore does not either, so the stylus stays on
 * the groove it is playing without anything having to travel with it.
 *
 * It could not always. With the sleeve at the left edge of the frame there was
 * less room beside it than the overlap was wide, so the record had to give way
 * too and take the arm with it. Centring the arrangement gave the cover the
 * room to do the whole move itself, and a card you push out and tuck under is
 * one object moving, not two.
 */
/** How much daylight to leave between the two when they are apart. */
const SWAP_AIR = 16

export const SWAP = {
  /**
   * How far the cover lies over once it is behind the record, in degrees.
   *
   * Negative is anticlockwise on screen, which lifts the upper *right* corner
   * and drops the upper left — a sleeve pushed under something and left askew,
   * rather than one squared up to the frame. Only the back of the stack gets
   * it; the front sits square.
   */
  BACK_TILT_DEG: -4,
  /**
   * Far enough left to be wholly clear of the record, plus a little air.
   *
   * Derived, not chosen: it is whatever the overlap happens to be. A fixed
   * number was right until the overlap grew to half the disc, at which point
   * the cover stopped clearing and the flip would have shown as a pop inside
   * the band — which is the one thing the hold in the middle exists to
   * prevent.
   */
  COVER_SHIFT: -(TUCK_FRACTION * RECORD.RADIUS * 2 + SWAP_AIR),
} as const

/** Gap between the two at full travel. Must be positive, or the flip shows. */
export const SWAP_CLEARANCE =
  Math.abs(SWAP.COVER_SHIFT) - TUCK_FRACTION * RECORD.RADIUS * 2

/**
 * How much to scale the design box to fill a window, and where to put it.
 *
 * One uniform scale, never a stretch: the composition is specified at one
 * aspect and a non-uniform fit would make the record an ellipse.
 */
export type BoxFit = {
  scale: number
  /** Where the box's top-left corner lands, so it is centred in the window. */
  x: number
  y: number
}

export function fitBox(width: number, height: number): BoxFit {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : BOX.WIDTH
  const safeHeight = Number.isFinite(height) && height > 0 ? height : BOX.HEIGHT
  const scale = Math.min(safeWidth / BOX.WIDTH, safeHeight / BOX.HEIGHT)
  return {
    scale,
    x: (safeWidth - BOX.WIDTH * scale) / 2,
    y: (safeHeight - BOX.HEIGHT * scale) / 2,
  }
}
