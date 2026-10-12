/**
 * Keeps the camera framed on the machine, and moves it between the two views.
 *
 * All the arithmetic lives in geometry/framing.ts; this is the part that has
 * to touch three.js and React.
 *
 * Lid shut, the camera sits in front of the machine. Lid open, it is overhead.
 * Pressing Open does both at once — the lid rises and the camera arcs up over
 * the deck. The arc matters: easing the *elevation* rather than the position
 * vector is what sends the camera over the machine instead of cutting a chord
 * straight through it.
 *
 * Three hazards it exists to handle:
 *
 *   · A minimised window reports a 0 × 0 canvas. framing.ts guards its own
 *     divisions, but there is no point refitting to a window nobody can see,
 *     so those frames are skipped.
 *
 *   · `frameloop` drops to "demand" when nothing is moving — and a camera move
 *     is precisely the case where nothing else is. Every unconverged frame
 *     calls invalidate(), which sustains demand mode for the length of the
 *     move and then lets it go quiet again. Without it the camera would
 *     advance a frame per unrelated redraw, or not at all.
 *
 *   · Restoring a minimised window would otherwise show whatever was last
 *     drawn, at the old size, so visibility changes force a redraw too.
 */

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { fitCamera } from '../geometry/framing.js'
import { DEG, damp } from '../useFrameState.js'

/**
 * How briskly the camera travels between the two views. Deliberately weighty:
 * the lid arc should feel like a machine moving, not a cut.
 */
const POSE_LAMBDA = 3.4

/**
 * How briskly it slides sideways when the panel appears or disappears.
 *
 * Much quicker, because this one is tracking the panel's own 260ms fade. At
 * the pose rate the machine would still be gliding long after the panel had
 * gone, and the two would read as unrelated events rather than as the machine
 * making room.
 */
const PAN_LAMBDA = 10

/** Below these the move is over; stop asking for frames. */
const SETTLED_ANGLE = 0.02 * DEG
const SETTLED_DISTANCE = 0.0004

type Pose = { elevation: number; distance: number; targetX: number; targetY: number }

export function CameraRig({
  reserveRightPx,
  reserveBottomPx,
  lidOpen,
}: {
  reserveRightPx: number
  /**
   * Unlike the right-hand reserve, this one is held for as long as the lid is
   * open rather than tracking whether the bar is drawn. `targetY` rides the
   * pose rate because it carries the lid arc, so a reserve that came and went
   * on the idle timer would show up as a slow vertical drift.
   */
  reserveBottomPx: number
  /**
   * A prop rather than a read of the render state, because it has to be a
   * React-visible change: `useFrame` does not run at all in demand mode, so a
   * lid toggle while the scene is idle would never be noticed. The effect
   * below forces the one frame that gets the move started.
   */
  lidOpen: boolean
}) {
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const invalidate = useThree((state) => state.invalidate)

  /** Where the camera actually is. Null until the first frame snaps it. */
  const current = useRef<Pose | null>(null)

  useFrame((_, delta) => {
    if (size.width <= 0 || size.height <= 0) return

    const framing = fitCamera({
      width: size.width,
      height: size.height,
      reserveRightPx,
      reserveBottomPx,
      // Lid shut is the resting state, and it gets the front elevation.
      pose: lidOpen ? 'top' : 'front',
    })

    const target: Pose = {
      elevation: framing.elevationDeg * DEG,
      distance: framing.distance,
      targetX: framing.targetX,
      targetY: framing.targetY,
    }

    // First frame snaps. Launching with the camera swooping in from nowhere
    // would be a worse first impression than simply being there.
    if (!current.current) {
      current.current = { ...target }
    } else {
      const pose = current.current
      pose.elevation = damp(pose.elevation, target.elevation, POSE_LAMBDA, delta)
      pose.distance = damp(pose.distance, target.distance, POSE_LAMBDA, delta)
      pose.targetY = damp(pose.targetY, target.targetY, POSE_LAMBDA, delta)
      pose.targetX = damp(pose.targetX, target.targetX, PAN_LAMBDA, delta)
    }

    const pose = current.current
    camera.position.set(
      pose.targetX,
      pose.targetY + pose.distance * Math.sin(pose.elevation),
      pose.distance * Math.cos(pose.elevation),
    )
    camera.lookAt(pose.targetX, pose.targetY, 0)
    camera.updateProjectionMatrix()

    const moving =
      Math.abs(pose.elevation - target.elevation) > SETTLED_ANGLE ||
      Math.abs(pose.distance - target.distance) > SETTLED_DISTANCE ||
      Math.abs(pose.targetX - target.targetX) > SETTLED_DISTANCE ||
      Math.abs(pose.targetY - target.targetY) > SETTLED_DISTANCE

    if (moving) invalidate()
  })

  // A resize while idle must still be drawn, and so must a restore.
  useEffect(
    () => invalidate(),
    [invalidate, size.width, size.height, reserveRightPx, reserveBottomPx],
  )

  useEffect(() => {
    const redraw = () => invalidate()
    document.addEventListener('visibilitychange', redraw)
    window.addEventListener('focus', redraw)
    return () => {
      document.removeEventListener('visibilitychange', redraw)
      window.removeEventListener('focus', redraw)
    }
  }, [invalidate])

  return null
}
