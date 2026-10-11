/**
 * The floating timestamp that tracks the needle while dragging — spec §10.
 *
 * Without it you are dragging blind: 22° across a 3:30 track is ~9.5 seconds
 * per degree, so the arm's angle alone tells you almost nothing about where
 * you will land.
 *
 * The element itself is real DOM, rendered outside the canvas by Turntable so
 * it gets real text rendering. This component lives *inside* the canvas, and
 * each frame projects the stylus's world position to screen coordinates and
 * writes them straight to the element's style. No React state is involved —
 * this updates every frame, which is exactly what CLAUDE.md forbids rendering
 * through.
 */

import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { ARM_BASE_YAW_DEG, RECORD_SURFACE_Y, TONEARM, TONEARM_PIVOT } from '../geometry/dimensions.js'
import { DEG, useRenderStateRef } from '../useFrameState.js'
import { useInteraction } from './context.js'

function mmss(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`
}

const stylus = new Vector3()

export function NeedleReadout() {
  const stateRef = useRenderStateRef()
  const { readoutRef } = useInteraction()
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)

  useFrame(() => {
    const element = readoutRef.current
    if (!element) return

    const state = stateRef.current
    if (!state.isDragging) {
      element.style.opacity = '0'
      return
    }

    // Where the stylus is, from the same geometry the arm is rendered with.
    const bearing = (180 - ARM_BASE_YAW_DEG + state.armAngle) * DEG
    stylus.set(
      TONEARM_PIVOT.x + Math.cos(bearing) * TONEARM.EFFECTIVE_LENGTH,
      RECORD_SURFACE_Y,
      TONEARM_PIVOT.z + Math.sin(bearing) * TONEARM.EFFECTIVE_LENGTH,
    )
    stylus.project(camera)

    const x = (stylus.x * 0.5 + 0.5) * size.width
    const y = (-stylus.y * 0.5 + 0.5) * size.height

    element.style.opacity = '1'
    element.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
    element.textContent = mmss(state.progressMs)
  })

  return null
}
