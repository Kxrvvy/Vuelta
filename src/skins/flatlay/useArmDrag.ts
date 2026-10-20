/**
 * Dragging the tonearm to scrub, in the flat-lay.
 *
 * The 3D skin does this by intersecting the pointer's ray with the plane of
 * the record. There is no ray here, so the only thing that differs is turning
 * a pointer into a bearing: client coordinates come back into the design box,
 * and `armAngleAtPoint` does the rest.
 *
 * Everything after that is the same, and deliberately so -- `clampToGroove`
 * and `progressForArmAngle` live in `core/armMath.ts` and are shared with the
 * 3D skin, because the angle-to-time mapping is the contract, not a detail of
 * how the arm happens to be drawn.
 *
 * The rule that matters most, spec §10: the seek is committed on release,
 * never during the drag.
 */

import { useCallback, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'

import { clampToGroove, progressForArmAngle } from '../../core/armMath.js'
import type { RenderState } from '../../core/contract.js'
import { armAngleAtPoint, type BoxFit } from './geometry.js'

/** Spec §10: "Hold Shift to slow the angle-to-time mapping for fine control." */
const FINE_GAIN = 0.15

export type ArmDragHandlers = {
  onPointerDown: (event: ReactPointerEvent<SVGElement>) => void
  onPointerMove: (event: ReactPointerEvent<SVGElement>) => void
  onPointerUp: (event: ReactPointerEvent<SVGElement>) => void
  onPointerCancel: (event: ReactPointerEvent<SVGElement>) => void
}

export function useArmDrag(options: {
  stateRef: RefObject<RenderState>
  /** The element the design box is laid out in, for client-to-box conversion. */
  hostRef: RefObject<HTMLElement | null>
  fitRef: RefObject<BoxFit>
  /**
   * How far the record is currently shifted by the card move, in design
   * pixels. The arm travels with it, so the pointer has to come back into the
   * arm's own frame before it means an angle.
   */
  shiftRef: RefObject<number>
  onDragStart: () => void
  onDragTo: (progressMs: number) => void
  onDragEnd: () => void
}): ArmDragHandlers {
  const { stateRef, hostRef, fitRef, shiftRef, onDragStart, onDragTo, onDragEnd } = options

  const dragging = useRef(false)
  /** The angle the arm had when grabbed, and where the pointer was then. */
  const grabArmAngle = useRef(0)
  const grabPointerAngle = useRef(0)

  /** Client coordinates to design-box coordinates. */
  const toBox = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const host = hostRef.current
      const fit = fitRef.current
      if (!host || !fit || fit.scale <= 0) return null
      const rect = host.getBoundingClientRect()
      return {
        x: (clientX - rect.left - fit.x) / fit.scale - (shiftRef.current ?? 0),
        y: (clientY - rect.top - fit.y) / fit.scale,
      }
    },
    [hostRef, fitRef, shiftRef],
  )

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<SVGElement>) => {
      const point = toBox(event.clientX, event.clientY)
      const state = stateRef.current
      if (!point || !state) return

      event.stopPropagation()
      // Capture, so the drag survives the pointer leaving the arm -- which it
      // will, immediately, because the tube is nine pixels wide.
      event.currentTarget.setPointerCapture?.(event.pointerId)

      dragging.current = true
      grabArmAngle.current = state.armAngle
      grabPointerAngle.current = armAngleAtPoint(point)
      onDragStart()
    },
    [onDragStart, stateRef, toBox],
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<SVGElement>) => {
      if (!dragging.current) return
      const point = toBox(event.clientX, event.clientY)
      const state = stateRef.current
      if (!point || !state) return

      event.stopPropagation()

      // Blend from the grab point rather than jumping to the pointer, so Shift
      // can scale the movement without the arm leaping on the first frame.
      const gain = event.shiftKey ? FINE_GAIN : 1
      const raw = grabArmAngle.current + (armAngleAtPoint(point) - grabPointerAngle.current) * gain
      const angle = clampToGroove(raw)

      // Straight into the render state; the scene reads it next frame. The
      // seek itself waits for release.
      state.armAngle = angle
      onDragTo(progressForArmAngle(angle, state.durationMs))
    },
    [onDragTo, stateRef, toBox],
  )

  const finish = useCallback(
    (event: ReactPointerEvent<SVGElement>) => {
      if (!dragging.current) return
      dragging.current = false
      event.stopPropagation()
      event.currentTarget.releasePointerCapture?.(event.pointerId)
      // Spec §10: "Commit seek on drag release only."
      onDragEnd()
    },
    [onDragEnd],
  )

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: finish,
    onPointerCancel: finish,
  }
}
