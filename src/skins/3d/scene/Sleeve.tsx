/**
 * The album cover, and the card move that sends it behind the record or
 * brings it back in front.
 *
 * Only ever seen in the flat-lay, which is why it sits on its own layer: the
 * other two looks are of a machine, and a machine with a record jacket lying
 * across its deck would be nonsense.
 *
 * The cover and the record are a two-card stack. Neither changes place; all a
 * click changes is which of them is on top. It is the *cover* that moves,
 * every time, because the record has a tonearm tracking the groove it is
 * playing and nothing about that should shift when the artwork does.
 *
 * The move itself is three ordered phases -- out, across, back -- and lives in
 * core/cardSwap.ts where it can be stepped in a test. The gesture is purely
 * visual: the record goes on playing either way, and the disc remains the
 * play/pause target, so the two never collide.
 */

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { Group } from 'three'
import { cardSwap, CARD_SWAP_MS } from '../../../core/cardSwap.js'
import {
  SLEEVE,
  SLEEVE_CLEAR_X,
  SLEEVE_X,
  STACK_BACK_Y,
  STACK_FRONT_Y,
} from '../geometry/dimensions.js'
import { sleeveMaterial } from '../materials/surfaces.js'
import { setCursor } from '../useFrameState.js'
import { useAlbumArtTexture } from './useAlbumArt.js'

export function Sleeve({
  albumArtUrl,
  inFront,
  onToggle,
}: {
  albumArtUrl: string | null
  /** True when the cover is the card on top of the record. */
  inFront: boolean
  onToggle: () => void
}) {
  const group = useRef<Group>(null)
  const invalidate = useThree((state) => state.invalidate)
  const art = useAlbumArtTexture(albumArtUrl)

  const material = useMemo(() => sleeveMaterial(art), [art])
  useEffect(() => () => material.dispose(), [material])

  /** Milliseconds into the current move, or null when it is over. */
  const elapsed = useRef<number | null>(null)
  /** The height it is travelling from. Captured when the move starts. */
  const fromY = useRef(inFront ? STACK_FRONT_Y : STACK_BACK_Y)
  /** Arriving is not a move. */
  const settled = useRef(false)

  useEffect(() => {
    // Nothing animates on the way in. The card is simply already where it
    // belongs -- and a move with nothing to travel is worse than pointless:
    // it slides out, and if the render loop goes quiet before it finishes it
    // stays out, which is how the cover came to sit detached from the record
    // after every reload.
    if (!settled.current) {
      settled.current = true
      return
    }

    const sleeve = group.current
    fromY.current = sleeve ? sleeve.position.y : inFront ? STACK_BACK_Y : STACK_FRONT_Y
    elapsed.current = 0
    // A move is exactly the case where nothing else is asking for frames.
    invalidate()
  }, [inFront, invalidate])

  useFrame((_, delta) => {
    const sleeve = group.current
    if (!sleeve || elapsed.current === null) return

    elapsed.current += delta * 1000
    const progress = Math.min(1, elapsed.current / CARD_SWAP_MS)
    const { out, crossed } = cardSwap(progress)

    const toY = inFront ? STACK_FRONT_Y : STACK_BACK_Y
    sleeve.position.x = SLEEVE_X + out * SLEEVE_CLEAR_X
    sleeve.position.y = fromY.current + (toY - fromY.current) * crossed

    if (progress >= 1) elapsed.current = null
    else invalidate()
  })

  const half = SLEEVE.SIZE / 2

  return (
    <group
      ref={group}
      position={[SLEEVE_X, inFront ? STACK_FRONT_Y : STACK_BACK_Y, 0]}
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

      {/* The open edge, on the side the record comes out of.
          Corner to corner, and not a fraction less. It used to stop 2% short
          at each end, which left a bright tab of artwork sticking out past the
          dark edge at the top and bottom corners -- so the cover's edge
          stepped in and out, and in motion that reads as a piece of the sleeve
          being cut away. */}
      <mesh position={[half - 0.0016, SLEEVE.THICKNESS / 2 + 0.0002, 0]}>
        <boxGeometry args={[0.0032, SLEEVE.THICKNESS * 0.6, SLEEVE.SIZE]} />
        <meshStandardMaterial color="#0d0b0a" roughness={0.95} metalness={0} />
      </mesh>
    </group>
  )
}
