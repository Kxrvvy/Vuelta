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

import { PLATTER_RPM } from '../../../core/contract.js'

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

/**
 * The album sleeve, which exists only in the flat-lay look.
 *
 * A real 12" jacket is 315mm square -- a little larger than the 302mm record,
 * which is what lets the record live inside it. It lies in the record's own
 * plane and slightly *above* it, because a record slides out from inside its
 * sleeve and the front panel has to cover it.
 */
export const SLEEVE = {
  SIZE: 0.315,
  THICKNESS: 0.0032,
  /** Gap between sleeve and record once the record is out. */
  GAP: 0.012,
} as const

/**
 * Where the sleeve lies, and it does not move.
 *
 * Beside the record and clear of it: its right edge stops a finger's width
 * short of the record's left rim, so neither one ever hides any part of the
 * other. They overlapped for a while, which is what made "in front" and
 * "behind" visible at a glance -- but it also meant that whichever was behind
 * had a bite taken out of it by the other, and the artwork losing a third of
 * itself was the wrong trade.
 *
 * The click still raises and lowers the cover, and still slides it out and
 * back. With nothing overlapping, the change of depth itself is almost
 * invisible; the slide is what you see.
 */
export const SLEEVE_RIGHT_EDGE_X = -RECORD.RADIUS - SLEEVE.GAP
export const SLEEVE_X = SLEEVE_RIGHT_EDGE_X - SLEEVE.SIZE / 2

/** How much of the disc's diameter the cover lies over. Nothing, by design. */
export function sleeveCoverage(centerX: number): number {
  const right = centerX + SLEEVE.SIZE / 2
  const covered = Math.min(right, RECORD.RADIUS) - -RECORD.RADIUS
  return Math.max(0, Math.min(1, covered / (RECORD.RADIUS * 2)))
}

/**
 * How far left the cover slides during the move.
 *
 * A fixed travel rather than "however far it takes to clear the record",
 * which is what it used to be: the cover starts clear now, so the distance is
 * free. Kept inside the margin the frame already leaves beside the
 * arrangement, because the alternative is to widen the shot to hold the slide
 * -- and that empty strip is reserved at rest too, which pushed everything
 * off-centre for the sake of two thirds of a second.
 */
export const SLEEVE_CLEAR_X = -0.06

export const PLATTER = {
  RADIUS: 0.1495,
  HEIGHT: 0.014,
  /** Felt slipmat between platter and record. */
  MAT_THICKNESS: 0.0012,
} as const

/** Top face of the record, where the stylus rides. */
export const RECORD_SURFACE_Y = PLATTER.HEIGHT + PLATTER.MAT_THICKNESS + RECORD.THICKNESS

/**
 * The two heights the cover sits at: in front of the record, or behind it.
 *
 * Far enough either side of the record's own plane that nothing z-fights at a
 * glancing 86 degrees, and far enough below, at the back, to clear the
 * record's underside rather than its face.
 */
export const STACK_FRONT_Y = RECORD_SURFACE_Y + 0.005
export const STACK_BACK_Y = RECORD_SURFACE_Y - 0.008

/** The higher of the two, which is what the camera has to frame. */
export const SLEEVE_Y = STACK_FRONT_Y

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

/**
 * The digital counter, set into the deck at its front-right corner.
 *
 * Front-right reads as lower-right on screen: the overhead camera looks down
 * the -z axis, so +z projects toward the bottom of the frame and +x to the
 * right.
 *
 * There is far more room on this side than the left — 161mm of clear deck
 * against 58mm — because the platter well cuts the left wedge down while the
 * right opens out toward the arm pivot. Some of that room is taken: the panel
 * is about a third larger than the left wedge allowed, which it needs — it
 * renders barely 100 pixels across, and at the size the left side permitted
 * the colons disappeared entirely.
 *
 * Three things it has to stay clear of, in order of how close they come:
 *
 *   · the deck border, 4mm to the right and 6mm to the front
 *   · the tonearm, whose furthest-forward reach is the stylus at REST_ANGLE,
 *     at x = 0.121 — 71mm short of the panel. The tube itself runs back
 *     toward the pivot, so within the panel's span it sits around z = -0.05
 *   · the platter well, a distant 74mm away
 *
 * `dimensions.test.ts` holds all three, because every one of them is set in a
 * different file.
 */
export const DISPLAY = {
  WIDTH: 0.076,
  DEPTH: 0.0285,
  /**
   * Measured from the spindle, not from the plinth centre — unlike GRILLE,
   * KNOB and OPEN_BUTTON, which are offsets on the cabinet face.
   *
   * Deliberate: what constrains this panel is the deck and the arm, both of
   * which are placed from the spindle. Expressing it against the cabinet
   * would hide those relationships behind an addition.
   */
  CENTER_X: 0.2125,
  CENTER_Z: 0.1375,
  /** How far the lit face sits above the deck, and how deep the bezel sinks. */
  FACE_Y: 0.0019,
  BEZEL_MARGIN: 0.0035,
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
  /**
   * The flat-lay. Almost straight down, because that is how the reference is
   * shot: a sleeve and a record laid on a surface and photographed from above.
   *
   * Not 90. CameraRig aims the camera with `lookAt` and the default up vector,
   * and looking exactly along -y with up +y is the degenerate case that
   * produces a NaN matrix. Four degrees off is flat to the eye and nowhere
   * near it.
   */
  CLOSEUP_ELEVATION_DEG: 86,
  FOV: 32,
} as const

export type CameraPose = 'top' | 'front' | 'closeup'

export function elevationFor(pose: CameraPose): number {
  if (pose === 'front') return CAMERA.FRONT_ELEVATION_DEG
  if (pose === 'closeup') return CAMERA.CLOSEUP_ELEVATION_DEG
  return CAMERA.TOP_ELEVATION_DEG
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

/**
 * What the flat-lay frames: the sleeve, the record, and as much of the arm as
 * fits. No cabinet -- there is no turntable in this view at all.
 *
 * Fixed at the sleeve's *out* position, which is the wider of the two states,
 * so that sliding the record in and out does not re-frame the shot.
 *
 * The right edge stops short of the arm's bearing on purpose: the counterweight
 * tail runs past the frame, the way both reference photographs crop it.
 * Including it would cost the record a quarter of its size for a part of the
 * arm that does nothing.
 */
// Framed where it rests, which is where it is for all but two thirds of a
// second: the cover's own left edge, with no allowance for the slide. The
// slide lives in the margin the fill already leaves beside the arrangement,
// so the shot neither re-frames mid-move nor sits off-centre the rest of the
// time waiting for one.
const FLATLAY_LEFT = SLEEVE_X - SLEEVE.SIZE / 2
const FLATLAY_RIGHT = 0.24

export const CLOSEUP_BOX = {
  WIDTH: FLATLAY_RIGHT - FLATLAY_LEFT,
  CENTER_X: (FLATLAY_LEFT + FLATLAY_RIGHT) / 2,
} as const

/** What the camera fits against, per pose. */
export function fitBoxFor(pose: CameraPose): { WIDTH: number; CENTER_X: number } {
  return pose === 'closeup' ? CLOSEUP_BOX : FIT_BOX
}

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

  if (pose === 'front') return cabinet
  if (pose === 'top') return [...cabinet, raisedLidTip()]

  // The flat-lay sees none of the machine: a sleeve and a record lying flat,
  // both of which are deeper than they are tall. The arm's bearing sits well
  // inside this in depth and contributes almost nothing in height from an
  // angle this close to vertical, so it does not drive the fit.
  return [
    { y: SLEEVE_Y, z: SLEEVE.SIZE / 2 },
    { y: SLEEVE_Y, z: -SLEEVE.SIZE / 2 },
    { y: RECORD_SURFACE_Y, z: RECORD.RADIUS },
    { y: RECORD_SURFACE_Y, z: -RECORD.RADIUS },
  ]
}

/**
 * The platter rate in degrees per second — 16⅔ rpm, so 100°/s.
 *
 * Derived from the contract rather than restated, because `platterRpm` travels
 * through RenderState and the two numbers must agree. See PLATTER_RPM for why
 * the disc turns at half the real speed of an LP.
 */
export const PLATTER_DEG_PER_SEC = PLATTER_RPM * 6
