/**
 * The volume knob — spec §11.
 *
 * Click and hold, then slide **horizontally**. Not vertical, and not circular:
 * circular dragging on screen is fiddly, and horizontal reads as a natural
 * volume axis. The knob still rotates visually as it tracks.
 *
 * The scroll wheel works too, but only while the pointer is over the knob, so
 * a stray wheel event over the record cannot silently change playback volume.
 *
 * At the top-down camera angle this is a small target — roughly 20×10 px — so
 * the hit volume is deliberately larger than the visible geometry, and the
 * panel carries a full-size mirror of the same control.
 */

import { useFrame } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { useCallback, useRef } from 'react'
import type { Group } from 'three'
import { KNOB, PLINTH } from '../geometry/dimensions.js'
import { chromeMaterial, plasticMaterial } from '../materials/surfaces.js'
import { useInteraction } from '../interaction/context.js'
import { DEG, damp, setCursor } from '../useFrameState.js'

/** Screen pixels of horizontal travel for the full 0–100 range. */
const PIXELS_FOR_FULL_RANGE = 260

/** Degrees of knob rotation across the full range. */
const SWEEP_DEG = 270

const FRONT_Z = PLINTH.CENTER_Z + PLINTH.DEPTH / 2

export function Knob({ volumePercent }: { volumePercent: number | null }) {
  const { actions } = useInteraction()
  const body = useRef<Group>(null)

  const dragging = useRef(false)
  const grabX = useRef(0)
  const grabVolume = useRef(0)
  /** Mirrors the value being dragged, so the knob tracks without re-rendering. */
  const shown = useRef(volumePercent ?? 50)

  const commit = useCallback(
    (percent: number) => {
      const clamped = Math.max(0, Math.min(100, percent))
      shown.current = clamped
      actions.setVolume(clamped)
    },
    [actions],
  )

  const onPointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation()
      ;(event.target as Element | null)?.setPointerCapture?.(event.pointerId)
      dragging.current = true
      grabX.current = event.nativeEvent.clientX
      grabVolume.current = shown.current
    },
    [],
  )

  const onPointerMove = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!dragging.current) return
      event.stopPropagation()
      const travelled = event.nativeEvent.clientX - grabX.current
      commit(grabVolume.current + (travelled / PIXELS_FOR_FULL_RANGE) * 100)
    },
    [commit],
  )

  const onPointerUp = useCallback((event: ThreeEvent<PointerEvent>) => {
    if (!dragging.current) return
    dragging.current = false
    event.stopPropagation()
    ;(event.target as Element | null)?.releasePointerCapture?.(event.pointerId)
  }, [])

  const onWheel = useCallback(
    (event: ThreeEvent<WheelEvent>) => {
      event.stopPropagation()
      commit(shown.current - Math.sign(event.nativeEvent.deltaY) * 4)
    },
    [commit],
  )

  useFrame((_, delta) => {
    const group = body.current
    if (!group) return
    // Follow the external value unless the user is mid-drag, in which case
    // the drag is authoritative.
    if (!dragging.current && volumePercent !== null) shown.current = volumePercent
    const target = (shown.current / 100 - 0.5) * SWEEP_DEG * DEG
    group.rotation.z = damp(group.rotation.z, -target, 14, delta)
  })

  return (
    <group position={[PLINTH.CENTER_X + KNOB.OFFSET_X, KNOB.OFFSET_Y, FRONT_Z]}>
      {/* Hit volume, invisible and considerably larger than the knob. Without
          this the control is close to ungrabbable at this camera angle. */}
      <mesh
        visible={false}
        position={[0, 0, KNOB.HEIGHT]}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(event) => event.stopPropagation()}
        onWheel={onWheel}
        onPointerOver={() => setCursor('ew-resize')}
        onPointerOut={() => setCursor('default')}
      >
        <boxGeometry args={[KNOB.RADIUS * 3.4, KNOB.RADIUS * 3.4, KNOB.HEIGHT * 4]} />
        <meshBasicMaterial />
      </mesh>

      <group ref={body}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[KNOB.RADIUS, KNOB.RADIUS, KNOB.HEIGHT, 48]} />
          <primitive object={plasticMaterial()} attach="material" />
        </mesh>
        <mesh position={[0, 0, KNOB.HEIGHT / 2]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[KNOB.RADIUS * 0.72, KNOB.RADIUS * 0.72, 0.0022, 48]} />
          <primitive object={chromeMaterial()} attach="material" />
        </mesh>
        {/* Pointer line, so the rotation is actually readable. */}
        <mesh position={[0, KNOB.RADIUS * 0.45, KNOB.HEIGHT / 2 + 0.0012]}>
          <boxGeometry args={[0.0016, KNOB.RADIUS * 0.7, 0.0008]} />
          <primitive object={chromeMaterial()} attach="material" />
        </mesh>
      </group>
    </group>
  )
}
