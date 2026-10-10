/**
 * The tonearm.
 *
 * Two rotations, not one:
 *
 *   yaw (y)   sweeps across the record, driven by `armAngle` from core
 *   lift (x)  raises the stylus off the surface when at rest
 *
 * Only yaw is driven today. The lift axis is built now anyway, because M3's
 * pause behaviour ("arm returns to REST_ANGLE") and M6's record swap both need
 * it, and retrofitting an axis into an assembled rig is worse than leaving one
 * idle for a milestone.
 *
 * The arm model points along −x from its pivot. `ARM_BASE_YAW_DEG` is derived
 * in dimensions.ts from the pivot geometry so that `armAngle` 0 puts the
 * stylus exactly on the outer groove and 22 puts it on the inner one.
 */

import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Group } from 'three'
import { ARM } from '../../../core/contract.js'
import {
  ARM_BASE_YAW_DEG,
  RECORD_SURFACE_Y,
  TONEARM,
  TONEARM_PIVOT,
} from '../geometry/dimensions.js'
import { chromeMaterial, plasticMaterial, stylusMaterial } from '../materials/surfaces.js'
import { DEG, damp, useRenderStateRef } from '../useFrameState.js'

const L = TONEARM.EFFECTIVE_LENGTH

export function Tonearm() {
  const stateRef = useRenderStateRef()
  const yaw = useRef<Group>(null)
  const lift = useRef<Group>(null)

  useFrame((_, delta) => {
    const state = stateRef.current
    const yawGroup = yaw.current
    const liftGroup = lift.current
    if (!yawGroup || !liftGroup) return

    const targetYaw = (ARM_BASE_YAW_DEG - state.armAngle) * DEG
    // Damped rather than snapped: a poll correction should ease the arm across,
    // never jump it. Spec §8 asks for exactly this at the data layer; the skin
    // honours it visually too.
    yawGroup.rotation.y = damp(yawGroup.rotation.y, targetYaw, 6, delta)

    const shouldLift = state.armAngle <= ARM.REST_ANGLE || !state.isPlaying
    const targetLift = shouldLift ? -0.05 : 0
    liftGroup.rotation.x = damp(liftGroup.rotation.x, targetLift, 5, delta)
  })

  return (
    <group position={[TONEARM_PIVOT.x, RECORD_SURFACE_Y, TONEARM_PIVOT.z]}>
      {/* Pivot housing: the recessed black plate bolted to the deck. */}
      <mesh position={[0, -0.004, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.055, 0.016, 0.082]} />
        <primitive object={plasticMaterial()} attach="material" />
      </mesh>
      <mesh position={[0, 0.012, 0]} castShadow>
        <cylinderGeometry args={[0.016, 0.019, 0.026, 32]} />
        <primitive object={plasticMaterial()} attach="material" />
      </mesh>

      <group ref={yaw} position={[0, TONEARM.PIVOT_HEIGHT - RECORD_SURFACE_Y, 0]}>
        <group ref={lift}>
          {/* Counterweight, behind the pivot. Rotated onto the arm's axis —
              three's cylinders stand on y by default, which from overhead
              reads as a floating ball rather than a weight on a stub. */}
          <mesh
            position={[TONEARM.COUNTERWEIGHT_OFFSET, 0, 0]}
            rotation={[0, 0, Math.PI / 2]}
            castShadow
          >
            <cylinderGeometry
              args={[
                TONEARM.COUNTERWEIGHT_RADIUS,
                TONEARM.COUNTERWEIGHT_RADIUS,
                0.026,
                32,
              ]}
            />
            <primitive object={plasticMaterial()} attach="material" />
          </mesh>
          <mesh
            position={[TONEARM.COUNTERWEIGHT_OFFSET * 0.45, 0, 0]}
            rotation={[0, 0, Math.PI / 2]}
            castShadow
          >
            <cylinderGeometry args={[0.005, 0.005, 0.05, 16]} />
            <primitive object={chromeMaterial()} attach="material" />
          </mesh>

          {/* The tube. Straight chrome, as in the reference — not an S-arm. */}
          <mesh
            position={[-(L - TONEARM.HEADSHELL_LENGTH) / 2, 0, 0]}
            rotation={[0, 0, Math.PI / 2]}
            castShadow
          >
            <cylinderGeometry
              args={[
                TONEARM.TUBE_RADIUS,
                TONEARM.TUBE_RADIUS * 1.15,
                L - TONEARM.HEADSHELL_LENGTH,
                24,
              ]}
            />
            <primitive object={chromeMaterial()} attach="material" />
          </mesh>

          {/* Headshell, set at the classic offset angle. */}
          <group
            position={[-(L - TONEARM.HEADSHELL_LENGTH), 0, 0]}
            rotation={[0, TONEARM.HEADSHELL_OFFSET_DEG * DEG, 0]}
          >
            <mesh position={[-TONEARM.HEADSHELL_LENGTH / 2, -0.004, 0]} castShadow>
              <boxGeometry args={[TONEARM.HEADSHELL_LENGTH, 0.016, 0.019]} />
              <primitive object={plasticMaterial()} attach="material" />
            </mesh>
            {/* Cartridge body and the red stylus that rides the groove. */}
            <mesh position={[-TONEARM.HEADSHELL_LENGTH * 0.85, -0.012, 0]} castShadow>
              <boxGeometry args={[0.014, 0.01, 0.013]} />
              <primitive object={plasticMaterial()} attach="material" />
            </mesh>
            <mesh position={[-TONEARM.HEADSHELL_LENGTH * 0.92, -0.019, 0]}>
              <boxGeometry args={[0.004, 0.006, 0.0075]} />
              <primitive object={stylusMaterial()} attach="material" />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  )
}
