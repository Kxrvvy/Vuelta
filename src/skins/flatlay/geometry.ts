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
  LEFT: 70,
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
 * The signature of the layout, and the one number the slide is measured from:
 * at rest 35% is tucked, which is §9's "~65% clears the sleeve edge" seen from
 * the other side.
 */
export const TUCK_FRACTION = 0.35

export const RECORD = {
  RADIUS: 220,
  /** §5: label circle ⌀165. */
  LABEL_RADIUS: 82.5,
  /** §5: spindle hole ⌀12, punched through to the paper. */
  SPINDLE_RADIUS: 6,
  /** §4: a wider smooth band at the rim, with no ring texture. */
  LEAD_IN: 14,
  /** §4: smooth band just outside the label. */
  RUN_OUT: 10,
  /** §4: "ring period ~2px. The grooves should be felt, not counted." */
  GROOVE_PERIOD: 2,
  CENTER_Y: BOX.HEIGHT / 2,
} as const

/**
 * Where the record sits at rest, derived so that exactly `TUCK_FRACTION` of it
 * is behind the sleeve.
 */
export const RECORD_CENTER_X =
  SLEEVE.RIGHT_EDGE_X - TUCK_FRACTION * RECORD.RADIUS * 2 + RECORD.RADIUS

/**
 * Where the record sits when it is completely hidden.
 *
 * The sleeve and the record are both 440px across, so "fully behind it" is
 * exactly concentric -- there is no fudge factor to tune.
 */
export const RECORD_HIDDEN_CENTER_X = SLEEVE.CENTER_X

/** §9's travel: 286px. */
export const RECORD_TRAVEL = RECORD_CENTER_X - RECORD_HIDDEN_CENTER_X

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
 */
export const PIVOT_BEARING_DEG =
  (Math.atan2(180 - RECORD.CENTER_Y, 1105 - RECORD_CENTER_X) * 180) / Math.PI

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
 * The card move: how far each object travels while the cover changes places in
 * the stack.
 *
 * Both move, in opposite directions, and they have to clear each other -- the
 * stacking order flips while they are apart, so it is never seen as a pop
 * inside the overlap band. The cover alone cannot do it: 154px of it is behind
 * the record and there are only 70px of frame to its left.
 *
 * The record takes the larger share because it has the room, and **the arm
 * travels with it**. That keeps the stylus on the groove it is playing, which
 * was the whole reason the old rule said the record must never move.
 */
export const SWAP = {
  /** Left, as far as the frame allows. */
  COVER_SHIFT: -62,
  /** Right, with the tonearm. */
  RECORD_SHIFT: 108,
  /**
   * How far the cover lies over once it is behind the record, in degrees.
   *
   * Negative is anticlockwise on screen, which lifts the upper *right* corner
   * and drops the upper left — a sleeve pushed under something and left askew,
   * rather than one squared up to the frame. Only the back of the stack gets
   * it; the front sits straight.
   *
   * Small on purpose. At 440px square even four degrees moves a corner 16px,
   * which is plenty to read as "put down carelessly" and little enough that
   * the cover stays inside the design box.
   */
  BACK_TILT_DEG: -4,
} as const

/** Gap between the two at full travel. Must be positive, or the flip shows. */
export const SWAP_CLEARANCE =
  SWAP.RECORD_SHIFT - SWAP.COVER_SHIFT - TUCK_FRACTION * RECORD.RADIUS * 2

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
