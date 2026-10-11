/**
 * The clear acrylic dust cover.
 *
 * Hinged along the back edge, driven by `lidOpen`. The motion is damped rather
 * than linear so it carries weight — spec §17 notes that most of this app's
 * design is motion, and a lid that snaps is the fastest way to break the
 * illusion. M4 replaces this damping with a proper timeline sequence; the
 * geometry and hinge will not need to change.
 *
 * Materials, not transmission: see the note on `acrylicMaterial`. The lid's
 * cut edges get their own brighter material because on real acrylic the edges
 * pipe light and read far brighter than the faces.
 */

import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { DoubleSide, type Group } from 'three'
import { LID, PLINTH } from '../geometry/dimensions.js'
import { useInteraction } from '../interaction/context.js'
import { acrylicEdgeMaterial, acrylicMaterial, plasticMaterial } from '../materials/surfaces.js'
import { DEG, damp, setCursor, useRenderStateRef } from '../useFrameState.js'

export function Lid() {
  const stateRef = useRenderStateRef()
  const { toggleLid } = useInteraction()
  const hinge = useRef<Group>(null)

  useFrame((_, delta) => {
    const group = hinge.current
    if (!group) return
    const target = stateRef.current.lidOpen ? -LID.OPEN_ANGLE_DEG * DEG : 0
    group.rotation.x = damp(group.rotation.x, target, 3.2, delta)
  })

  const halfWidth = LID.WIDTH / 2
  const depth = LID.DEPTH

  // Every acrylic panel shares these, so a click anywhere on the lid counts.
  const clickable = {
    onClick: (event: { stopPropagation(): void }) => {
      event.stopPropagation()
      toggleLid()
    },
    onPointerOver: () => setCursor('pointer'),
    onPointerOut: () => setCursor('default'),
  }

  return (
    <group position={[PLINTH.CENTER_X, LID.HINGE_Y, LID.HINGE_Z]}>
      {/* Hinge barrels, visible at the back corners in the reference. */}
      {[-halfWidth + 0.03, halfWidth - 0.03].map((x) => (
        <mesh key={x} position={[x, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.0055, 0.0055, 0.016, 16]} />
          <primitive object={plasticMaterial()} attach="material" />
        </mesh>
      ))}

      <group ref={hinge}>
        {/* Click target for the whole lid.
            The visible acrylic is FrontSide — necessary, because double-sided
            at any useful opacity fogged the record over. But a FrontSide
            material is also invisible to the raycaster from behind, and once
            the lid swings open we are looking at its underside. So the hit
            surface is its own double-sided plane. */}
        <mesh
          visible={false}
          position={[0, LID.WALL_HEIGHT, depth / 2]}
          rotation={[-Math.PI / 2, 0, 0]}
          {...clickable}
        >
          <planeGeometry args={[LID.WIDTH, depth]} />
          <meshBasicMaterial side={DoubleSide} />
        </mesh>

        {/* Top face. */}
        <mesh position={[0, LID.WALL_HEIGHT, depth / 2]} castShadow receiveShadow>
          <boxGeometry args={[LID.WIDTH, LID.THICKNESS, depth]} />
          <primitive object={acrylicMaterial()} attach="material" />
        </mesh>

        {/* Front wall, angled slightly forward as on the real cover. */}
        <mesh
          position={[0, LID.WALL_HEIGHT / 2, depth]}
          rotation={[0.06, 0, 0]}
          castShadow
          receiveShadow
          {...clickable}
        >
          <boxGeometry args={[LID.WIDTH, LID.WALL_HEIGHT, LID.THICKNESS]} />
          <primitive object={acrylicMaterial()} attach="material" />
        </mesh>

        {/* Side walls. */}
        {[-halfWidth, halfWidth].map((x) => (
          <mesh key={x} position={[x, LID.WALL_HEIGHT / 2, depth / 2]} castShadow {...clickable}>
            <boxGeometry args={[LID.THICKNESS, LID.WALL_HEIGHT, depth]} />
            <primitive object={acrylicMaterial()} attach="material" />
          </mesh>
        ))}

        {/* Bright cut edges along the front lip — the detail that makes the
            lid read as thick acrylic rather than as a sheet of glass. */}
        <mesh position={[0, LID.WALL_HEIGHT + LID.THICKNESS / 2, depth]}>
          <boxGeometry args={[LID.WIDTH, LID.THICKNESS * 1.1, LID.THICKNESS * 1.1]} />
          <primitive object={acrylicEdgeMaterial()} attach="material" />
        </mesh>
        <mesh position={[0, 0.001, depth]}>
          <boxGeometry args={[LID.WIDTH, LID.THICKNESS * 1.1, LID.THICKNESS * 1.1]} />
          <primitive object={acrylicEdgeMaterial()} attach="material" />
        </mesh>
      </group>
    </group>
  )
}
