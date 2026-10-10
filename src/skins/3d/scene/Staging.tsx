/**
 * Lighting and environment.
 *
 * The environment map is generated from a canvas drawn in textures.ts and run
 * through PMREMGenerator here. That is deliberate: the usual approach is a
 * preset HDRI, but those are fetched from a CDN at runtime, which the packaged
 * app's Content-Security-Policy forbids and which would make the scene depend
 * on the network. Drawing our own softboxes costs nothing and gives direct
 * control over where the sheen falls across the record.
 *
 * Staging is a dark field (spec §19's open question, now answered): the unit
 * floats on the app's own background rather than sitting on a surface, so
 * there is no ground plane and no contact shadow. Shadows that remain are
 * self-shadows — the arm onto the record, the lid onto the deck.
 */

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { PMREMGenerator } from 'three'
import { studioEnvironmentTexture } from '../materials/textures.js'

export function Staging() {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const frame = useRef(0)

  useEffect(() => {
    const pmrem = new PMREMGenerator(gl)
    pmrem.compileEquirectangularShader()
    const target = pmrem.fromEquirectangular(studioEnvironmentTexture())
    scene.environment = target.texture

    return () => {
      scene.environment = null
      target.dispose()
      pmrem.dispose()
    }
  }, [gl, scene])

  useEffect(() => {
    // The camera and lights never move and the arm crawls — 22° over three and
    // a half minutes. Refreshing the shadow map every frame is pure waste.
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = true
    return () => {
      gl.shadowMap.autoUpdate = true
    }
  }, [gl])

  useFrame(() => {
    frame.current += 1
    if (frame.current % 12 === 0) gl.shadowMap.needsUpdate = true
  })

  return (
    <>
      <color attach="background" args={['#141210']} />
      <ambientLight intensity={0.38} />

      {/* Key: high and to the left-back, which is where the reference's main
          softbox sits. This is the one that casts the arm's shadow. */}
      <directionalLight
        position={[-0.55, 1.1, -0.35]}
        intensity={2.3}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={0.1}
        shadow-camera-far={3}
        shadow-camera-left={-0.4}
        shadow-camera-right={0.4}
        shadow-camera-top={0.4}
        shadow-camera-bottom={-0.4}
        shadow-bias={-0.0006}
        shadow-normalBias={0.004}
      />

      {/* Fill from the front-right, so the grille and knob do not go black. */}
      <directionalLight position={[0.8, 0.5, 0.75]} intensity={0.85} />

      {/* Rim along the back edge, to separate the cabinet from the dark field. */}
      <directionalLight position={[0.15, 0.35, -1]} intensity={0.95} color="#b8c6d6" />
    </>
  )
}
