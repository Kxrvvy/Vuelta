/**
 * The Open button, on the front face beside the volume knob.
 *
 * A latch release, not a toggle: it opens the lid and nothing else. Closing
 * stays the gesture it has always been — click the acrylic. Two one-way
 * controls rather than one that changes meaning under the cursor.
 *
 * While the lid is already open it is inert: no hover cursor, no press, no
 * action. There is nothing left to release.
 */

import { useFrame } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { useCallback, useRef } from 'react'
import { MeshStandardMaterial, type Group } from 'three'
import { OPEN_BUTTON, PLINTH } from '../geometry/dimensions.js'
import { useInteraction } from '../interaction/context.js'
import { openButtonTexture } from '../materials/textures.js'
import { damp, setCursor } from '../useFrameState.js'

const FRONT_Z = PLINTH.CENTER_Z + PLINTH.DEPTH / 2

/** Not cached in surfaces.ts: only this component ever uses it. */
let faceMaterial: MeshStandardMaterial | null = null
function buttonFace(): MeshStandardMaterial {
  faceMaterial ??= new MeshStandardMaterial({
    map: openButtonTexture(),
    roughness: 0.52,
    metalness: 0.08,
  })
  return faceMaterial
}

export function OpenButton({ lidOpen }: { lidOpen: boolean }) {
  const { openLid } = useInteraction()
  const body = useRef<Group>(null)
  const pressed = useRef(false)

  const onDown = useCallback((event: ThreeEvent<PointerEvent>) => {
    if (lidOpen) return
    event.stopPropagation()
    pressed.current = true
  }, [lidOpen])

  const onUp = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!pressed.current) return
      pressed.current = false
      event.stopPropagation()
      if (!lidOpen) openLid()
    },
    [lidOpen, openLid],
  )

  useFrame((_, delta) => {
    const group = body.current
    if (!group) return
    const target = pressed.current ? -OPEN_BUTTON.TRAVEL : 0
    group.position.z = damp(group.position.z, target, 18, delta)
  })

  return (
    <group position={[PLINTH.CENTER_X + OPEN_BUTTON.OFFSET_X, OPEN_BUTTON.OFFSET_Y, FRONT_Z]}>
      {/* Hit volume, invisible and larger than the button. At the overhead
          camera angle the front face is heavily foreshortened, so the visible
          geometry alone is a few pixels tall. */}
      <mesh
        visible={false}
        position={[0, 0, OPEN_BUTTON.DEPTH]}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={() => (pressed.current = false)}
        onClick={(event) => event.stopPropagation()}
        onPointerOver={() => setCursor(lidOpen ? 'default' : 'pointer')}
        onPointerOut={() => setCursor('default')}
      >
        <boxGeometry
          args={[OPEN_BUTTON.WIDTH * 1.5, OPEN_BUTTON.HEIGHT * 2.6, OPEN_BUTTON.DEPTH * 5]}
        />
        <meshBasicMaterial />
      </mesh>

      <group ref={body}>
        <mesh position={[0, 0, OPEN_BUTTON.DEPTH / 2]} castShadow receiveShadow>
          <boxGeometry args={[OPEN_BUTTON.WIDTH, OPEN_BUTTON.HEIGHT, OPEN_BUTTON.DEPTH]} />
          <primitive object={buttonFace()} attach="material" />
        </mesh>
      </group>
    </group>
  )
}
