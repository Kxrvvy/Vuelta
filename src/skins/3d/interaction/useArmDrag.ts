/**
 * Dragging the tonearm to scrub — spec §10.
 *
 * The maths, in one place. The pointer's ray is intersected with the plane of
 * the record, the resulting point is turned into a bearing from the arm's
 * pivot, and that bearing is turned back into an `armAngle` by inverting what
 * Tonearm.tsx does to render it:
 *
 *   render:  worldBearing = 180° − (ARM_BASE_YAW − armAngle)
 *   invert:  armAngle     = worldBearing − 180° + ARM_BASE_YAW
 *
 * Three mitigations for spec §10's precision problem — 22° across a 3:30 track
 * is ~9.5 s per degree, and half a degree of mouse precision is ±5 s:
 *
 *   · the angle is clamped to the groove band, so a drag can never seek past
 *     the start or end of the track
 *   · holding Shift scales movement down relative to where you grabbed
 *   · a floating timestamp tracks the needle (rendered by NeedleReadout)
 *
 * And the rule that matters most: the seek is committed on release, never
 * during the drag.
 */

import { useCallback, useRef } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { clampToGroove, progressForArmAngle } from '../../../core/armMath.js'
import { ARM_BASE_YAW_DEG, RECORD_SURFACE_Y, TONEARM_PIVOT } from '../geometry/dimensions.js'
import { useInteraction } from './context.js'
import { useRenderStateRef } from '../useFrameState.js'

const RAD_TO_DEG = 180 / Math.PI

/** Spec §10: "Hold Shift to slow the angle-to-time mapping for fine control." */
const FINE_GAIN = 0.15

/**
 * Where the pointer's ray crosses the record's surface, in world xz.
 * Returns null when the ray is parallel to the record, which cannot happen
 * with the fixed camera but would produce a divide-by-zero if it did.
 */
function pointerOnRecord(event: ThreeEvent<PointerEvent>): { x: number; z: number } | null {
  const { origin, direction } = event.ray
  if (Math.abs(direction.y) < 1e-6) return null
  const t = (RECORD_SURFACE_Y - origin.y) / direction.y
  if (t < 0) return null
  return { x: origin.x + direction.x * t, z: origin.z + direction.z * t }
}

/** World bearing from the pivot to a point, as the arm's own angle. */
function armAngleAt(point: { x: number; z: number }): number {
  const bearing =
    Math.atan2(point.z - TONEARM_PIVOT.z, point.x - TONEARM_PIVOT.x) * RAD_TO_DEG
  return bearing - 180 + ARM_BASE_YAW_DEG
}

export type ArmDragHandlers = {
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void
  onPointerMove: (event: ThreeEvent<PointerEvent>) => void
  onPointerUp: (event: ThreeEvent<PointerEvent>) => void
}

export function useArmDrag(): { handlers: ArmDragHandlers; isDragging: () => boolean } {
  const { beginArmDrag, dragToProgress, endArmDrag } = useInteraction()
  const stateRef = useRenderStateRef()

  const dragging = useRef(false)
  /** Angle the arm had when grabbed, and where the pointer was at that moment. */
  const grabArmAngle = useRef(0)
  const grabPointerAngle = useRef(0)

  const onPointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      const point = pointerOnRecord(event)
      if (!point) return

      event.stopPropagation()
      // Capture, so the drag survives the pointer leaving this thin mesh —
      // which it will, immediately, because the arm is a few pixels wide.
      ;(event.target as Element | null)?.setPointerCapture?.(event.pointerId)

      dragging.current = true
      grabArmAngle.current = stateRef.current.armAngle
      grabPointerAngle.current = armAngleAt(point)
      beginArmDrag()
    },
    [beginArmDrag, stateRef],
  )

  const onPointerMove = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!dragging.current) return
      const point = pointerOnRecord(event)
      if (!point) return

      event.stopPropagation()

      // Blend from the grab point rather than jumping to the pointer, so Shift
      // can scale the movement without the arm leaping on the first frame.
      const gain = event.nativeEvent.shiftKey ? FINE_GAIN : 1
      const raw = grabArmAngle.current + (armAngleAt(point) - grabPointerAngle.current) * gain
      const angle = clampToGroove(raw)

      // Write the angle straight to the render state; the scene reads it next
      // frame. The seek itself waits for release.
      stateRef.current.armAngle = angle
      dragToProgress(progressForArmAngle(angle, stateRef.current.durationMs))
    },
    [dragToProgress, stateRef],
  )

  const onPointerUp = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!dragging.current) return
      dragging.current = false
      event.stopPropagation()
      ;(event.target as Element | null)?.releasePointerCapture?.(event.pointerId)
      // Spec §10: "Commit seek on drag release only."
      endArmDrag()
    },
    [endArmDrag],
  )

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp },
    isDragging: () => dragging.current,
  }
}
