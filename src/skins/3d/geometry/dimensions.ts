/**
 * Every measurement in the scene, in metres, derived from the real objects.
 *
 * Spec §17 asks that "both the mockup and the code should use the same
 * numbers". This file is those numbers. Nothing in the scene may hardcode a
 * dimension — if it is a size or a position, it belongs here.
 *
 * Origin is the spindle, at the centre of the record, with y = 0 at the top
 * surface of the plinth. Everything else is placed relative to that, so the
 * record maths never has to know where the cabinet is.
 *
 *   +x  right        +z  toward the viewer (front)
 *   +y  up           -z  away (back, where the lid hinges)
 */

const DEG = Math.PI / 180

// ---------------------------------------------------------------------------
// The record — a standard 12" LP
// ---------------------------------------------------------------------------

export const RECORD = {
  /** 302 mm across, the real figure for a 12-inch LP. */
  RADIUS: 0.151,
  THICKNESS: 0.0019,
  /** Grooved area ends here; beyond it is the smooth lead-in and the rim. */
  GROOVE_OUTER: 0.146,
  /** Grooves stop here; between this and the label is the smooth run-out land. */
  GROOVE_INNER: 0.058,
  /** 100 mm label, as on virtually every commercial pressing. */
  LABEL_RADIUS: 0.05,
  /** 7.24 mm spindle hole. */
  HOLE_RADIUS: 0.00362,
} as const

export const PLATTER = {
  RADIUS: 0.1495,
  HEIGHT: 0.014,
  /** Felt slipmat between platter and record. */
  MAT_THICKNESS: 0.0012,
} as const

/** Top face of the record, where the stylus rides. */
export const RECORD_SURFACE_Y = PLATTER.HEIGHT + PLATTER.MAT_THICKNESS + RECORD.THICKNESS

// ---------------------------------------------------------------------------
// Tonearm
//
// The arm pivots about a point off to the right. Its sweep is set by two
// lengths: the pivot-to-spindle distance and the arm's effective length.
//
// Those two are not arbitrary. Spec §10 fixes the sweep at 22° between the
// outer and inner groove, and the law of cosines ties sweep to geometry:
//
//     φ(r) = acos( (D² + L² − r²) / (2·D·L) )
//
// With D = L = 0.235 m, φ(GROOVE_OUTER) − φ(GROOVE_INNER) = 22.01°, which
// lands on the spec's figure almost exactly. Both lengths are also physically
// plausible for a 9-inch arm. Change either and the 22° stops being true.
// ---------------------------------------------------------------------------

export const TONEARM = {
  PIVOT_TO_SPINDLE: 0.235,
  EFFECTIVE_LENGTH: 0.235,
  /** How far the pivot sits toward the back, measured from the +x axis. */
  BEARING_DEG: 15,
  TUBE_RADIUS: 0.0042,
  PIVOT_HEIGHT: 0.034,
  /** Classic offset: the headshell is angled relative to the tube. */
  HEADSHELL_OFFSET_DEG: 23,
  HEADSHELL_LENGTH: 0.038,
  COUNTERWEIGHT_RADIUS: 0.0165,
  COUNTERWEIGHT_OFFSET: 0.052,
  /** How far the arm lifts off the record when at rest. */
  LIFT_HEIGHT: 0.012,
} as const

/** Pivot position in the xz-plane, back and to the right of the spindle. */
export const TONEARM_PIVOT = {
  x: TONEARM.PIVOT_TO_SPINDLE * Math.cos(TONEARM.BEARING_DEG * DEG),
  z: -TONEARM.PIVOT_TO_SPINDLE * Math.sin(TONEARM.BEARING_DEG * DEG),
} as const

/** Angle at the pivot between "toward the spindle" and "stylus on groove r". */
function pivotAngleFor(radius: number): number {
  const d = TONEARM.PIVOT_TO_SPINDLE
  const l = TONEARM.EFFECTIVE_LENGTH
  return Math.acos((d * d + l * l - radius * radius) / (2 * d * l)) / DEG
}

/**
 * Yaw of the arm group when `armAngle` is 0 — i.e. stylus on the outer groove.
 *
 * Derivation: the arm model points along −x at yaw 0. The direction from pivot
 * to spindle sits at (180° − BEARING). Swinging the stylus forward by φ puts it
 * at (180° − BEARING − φ), and three's +y rotation decreases that bearing, so
 * the yaw needed is BEARING + φ. Spec §10's armAngle then subtracts from it.
 */
export const ARM_BASE_YAW_DEG = TONEARM.BEARING_DEG + pivotAngleFor(RECORD.GROOVE_OUTER)

/** Sanity value, exported so a test or the console can confirm it is ~22°. */
export const ARM_SWEEP_DEG = pivotAngleFor(RECORD.GROOVE_OUTER) - pivotAngleFor(RECORD.GROOVE_INNER)

// ---------------------------------------------------------------------------
// Cabinet
// ---------------------------------------------------------------------------

export const PLINTH = {
  WIDTH: 0.455,
  DEPTH: 0.355,
  HEIGHT: 0.098,
  /** Shifted right so the cabinet encloses both the record and the arm pivot. */
  CENTER_X: 0.048,
  CENTER_Z: 0,
  EDGE_RADIUS: 0.006,
} as const

export const FOOT = {
  RADIUS: 0.0125,
  HEIGHT: 0.009,
  INSET: 0.028,
} as const

export const GRILLE = {
  WIDTH: 0.235,
  HEIGHT: 0.062,
  /** Centre of the grille on the front face, relative to the plinth centre. */
  OFFSET_X: -0.085,
  OFFSET_Y: -0.05,
  HOLE_PITCH: 0.0034,
  HOLE_RADIUS: 0.0011,
} as const

export const KNOB = {
  RADIUS: 0.0205,
  HEIGHT: 0.016,
  OFFSET_X: 0.105,
  OFFSET_Y: -0.052,
} as const

/**
 * The Open button, on the front face to the right of the knob.
 *
 * The face runs to +0.2275 from the plinth centre and the knob's right edge
 * is at 0.1255, so this sits in the clear span between them with about 0.021
 * of breathing room on the knob side.
 */
export const OPEN_BUTTON = {
  WIDTH: 0.058,
  HEIGHT: 0.02,
  /** How far it stands proud of the face. */
  DEPTH: 0.005,
  OFFSET_X: 0.175,
  OFFSET_Y: -0.052,
  /** Travel when pressed. Small, but enough to read as a real button. */
  TRAVEL: 0.0018,
} as const

export const LED = {
  RADIUS: 0.0022,
  OFFSET_X: 0.062,
  OFFSET_Y: -0.047,
} as const

export const LID = {
  WIDTH: 0.463,
  DEPTH: 0.361,
  THICKNESS: 0.0032,
  /** Height of the lid's walls when it is down. */
  WALL_HEIGHT: 0.072,
  /** Hinge line, at the back edge of the plinth. */
  HINGE_Z: -0.1775,
  HINGE_Y: 0.004,
  /** How far it swings open. The reference photographs sit around here. */
  OPEN_ANGLE_DEG: 62,
} as const

// ---------------------------------------------------------------------------
// Camera — View A, "camera overhead, disc and tonearm fill the window"
// ---------------------------------------------------------------------------

export const CAMERA = {
  /**
   * Elevation above the horizon, in degrees — the one number separating the
   * two views.
   *
   * TOP is the overhead working view. 52° is the same angle as the 38° off
   * vertical it used to be written as, restated so both poses share a
   * vocabulary. FRONT looks at the face from just above it: level enough to
   * read the grille, knob and Open button head-on, high enough that a sliver
   * of the closed lid still shows and the machine keeps its depth.
   */
  TOP_ELEVATION_DEG: 52,
  FRONT_ELEVATION_DEG: 10,
  FOV: 32,
} as const

export type CameraPose = 'top' | 'front'

export function elevationFor(pose: CameraPose): number {
  return pose === 'front' ? CAMERA.FRONT_ELEVATION_DEG : CAMERA.TOP_ELEVATION_DEG
}

/**
 * The volume the camera frames against.
 *
 * Slightly larger than the cabinet itself: the lid overhangs it a little, and
 * a bare-minimum box would leave the machine touching the edges of the frame.
 */
export const FIT_BOX = {
  WIDTH: LID.WIDTH,
  DEPTH: LID.DEPTH,
  /** Feet to the top of the closed lid. */
  HEIGHT: PLINTH.HEIGHT + FOOT.HEIGHT + LID.WALL_HEIGHT,
  CENTER_X: PLINTH.CENTER_X,
} as const

/** Lowest point of the machine: the underside of the feet. */
const BOTTOM_Y = -(PLINTH.HEIGHT + FOOT.HEIGHT)

/**
 * The far edge of the lid's top panel once it has swung open.
 *
 * Derived by rotating that edge about the hinge rather than measured off a
 * screenshot, so it stays correct if the lid's travel or its dimensions ever
 * change. This point matters more than it looks: open, it is both the highest
 * part of the machine and — because the camera is above — the part nearest the
 * lens, which is not true of anything on the cabinet.
 */
function raisedLidTip(): { y: number; z: number } {
  const angle = LID.OPEN_ANGLE_DEG * (Math.PI / 180)
  // Position of that edge relative to the hinge, with the lid shut.
  const dy = LID.WALL_HEIGHT
  const dz = LID.DEPTH
  return {
    y: LID.HINGE_Y + dy * Math.cos(angle) + dz * Math.sin(angle),
    z: LID.HINGE_Z - dy * Math.sin(angle) + dz * Math.cos(angle),
  }
}

export type ProfilePoint = { y: number; z: number }

/**
 * The extreme points of the machine's outline, in the y/z plane.
 *
 * The camera fits against these rather than against a bounding box. A box is
 * the wrong shape once the lid is up — it overstates the silhouette by about
 * 18%, which would cost a far bigger shrink than the view actually needs, and
 * it cannot tell which point is closest to the lens.
 */
export function profilePoints(pose: CameraPose): ProfilePoint[] {
  const front = PLINTH.CENTER_Z + LID.DEPTH / 2
  const back = PLINTH.CENTER_Z - LID.DEPTH / 2
  const closedTop = LID.WALL_HEIGHT

  const cabinet: ProfilePoint[] = [
    { y: BOTTOM_Y, z: front },
    { y: BOTTOM_Y, z: back },
    { y: closedTop, z: front },
    { y: closedTop, z: back },
  ]

  return pose === 'front' ? cabinet : [...cabinet, raisedLidTip()]
}

/** 33⅓ rpm in degrees per second — 200°/s exactly. */
export const PLATTER_DEG_PER_SEC = (100 / 3) * 6
