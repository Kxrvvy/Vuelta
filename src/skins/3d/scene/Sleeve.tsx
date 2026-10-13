/**
 * The album sleeve, and the record sliding in and out of it.
 *
 * Only ever seen in the flat-lay, which is why it sits on its own layer: the
 * other two looks are of a machine, and a machine with a record jacket lying
 * across its deck would be nonsense.
 *
 * Clicking it slides the record in or out — or rather slides the *sleeve*,
 * which comes to the same thing on screen and is the better way round: the
 * record stays where the tonearm expects it, so the arm goes on tracking the
 * groove it is actually playing and nothing has to be re-aimed.
 *
 * The gesture is purely visual. The disc remains the play/pause target, so the
 * two never collide: cover slides, disc plays.
 */

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { Group } from 'three'
import { SLEEVE, SLEEVE_IN_X, SLEEVE_OUT_X, SLEEVE_Y } from '../geometry/dimensions.js'
import { sleeveMaterial } from '../materials/surfaces.js'
import { damp, setCursor } from '../useFrameState.js'
import { useAlbumArtTexture } from './useAlbumArt.js'

/** Brisk enough to feel like a hand, slow enough to read as a slide. */
const SLIDE_LAMBDA = 5.5

/** Below this the slide is over and the loop can go quiet again. */
const SETTLED = 0.0004

export function Sleeve({
  albumArtUrl,
  tucked,
  onToggle,
}: {
  albumArtUrl: string | null
  /** True when the record is back inside it. */
  tucked: boolean
  onToggle: () => void
}) {
  const group = useRef<Group>(null)
  const invalidate = useThree((state) => state.invalidate)
  const art = useAlbumArtTexture(albumArtUrl)

  const material = useMemo(() => sleeveMaterial(art), [art])
  useEffect(() => () => material.dispose(), [material])

  // A slide is exactly the case where nothing else is asking for frames, so
  // every unsettled one asks for the next. Same bargain as CameraRig.
  useEffect(() => invalidate(), [tucked, invalidate])

  useFrame((_, delta) => {
    const sleeve = group.current
    if (!sleeve) return
    const target = tucked ? SLEEVE_IN_X : SLEEVE_OUT_X
    sleeve.position.x = damp(sleeve.position.x, target, SLIDE_LAMBDA, delta)
    if (Math.abs(sleeve.position.x - target) > SETTLED) invalidate()
  })

  const half = SLEEVE.SIZE / 2

  return (
    <group
      ref={group}
      position={[tucked ? SLEEVE_IN_X : SLEEVE_OUT_X, SLEEVE_Y, 0]}
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
      onPointerOver={() => setCursor('pointer')}
      onPointerOut={() => setCursor('default')}
    >
      {/* The jacket itself. Board, not paper: it has a visible edge, and that
          edge is most of what stops it reading as a sticker on the floor. */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[SLEEVE.SIZE, SLEEVE.THICKNESS, SLEEVE.SIZE]} />
        <meshStandardMaterial color="#1d1917" roughness={0.9} metalness={0} />
      </mesh>

      {/* The printed face. Its own plane rather than a material on the box, so
          the art lands on the top and not on all six sides. */}
      <mesh position={[0, SLEEVE.THICKNESS / 2 + 0.0001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[SLEEVE.SIZE, SLEEVE.SIZE]} />
        <primitive object={material} attach="material" />
      </mesh>

      {/* The open edge, on the side the record comes out of. */}
      <mesh position={[half - 0.0016, SLEEVE.THICKNESS / 2 + 0.0002, 0]}>
        <boxGeometry args={[0.0032, SLEEVE.THICKNESS * 0.6, SLEEVE.SIZE * 0.96]} />
        <meshStandardMaterial color="#0d0b0a" roughness={0.95} metalness={0} />
      </mesh>
    </group>
  )
}
