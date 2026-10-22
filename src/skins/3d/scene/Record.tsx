/**
 * The record and the platter it sits on.
 *
 * One track = one record (CLAUDE.md domain model), so the centre label is the
 * current track's album art. When there is none — a local file, a podcast, or
 * simply nothing playing — it falls back to the red A.S.R / LEDA label from
 * the reference photographs.
 *
 * The whole group spins. Rotation is integrated against `delta`, never a fixed
 * per-frame step, so the speed is correct whatever the frame rate.
 */

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { Group } from 'three'
import { PLATTER, PLATTER_DEG_PER_SEC, RECORD, RECORD_SURFACE_Y } from '../geometry/dimensions.js'
import {
  chromeMaterial,
  feltMaterial,
  labelMaterial,
  vinylEdgeMaterial,
  vinylMaterial,
} from '../materials/surfaces.js'
import { fallbackLabelTexture } from '../materials/textures.js'
import { isSwipeDrag, swipeOffset, swipeOutcome, SWIPE_RUBBER_PX } from '../../../core/discSwipe.js'
import { useInteraction } from '../interaction/context.js'
import { DEG, damp, setCursor, useRenderStateRef } from '../useFrameState.js'
import { useAlbumArtTexture } from './useAlbumArt.js'

export function Record({ albumArtUrl }: { albumArtUrl: string | null }) {
  const stateRef = useRenderStateRef()
  const { actions } = useInteraction()
  const spinner = useRef<Group>(null)
  const degPerSec = useRef(0)

  // ---- pushing the record sideways ----------------------------------------
  // The same gesture the flat-lay has, off the same rule in `core`: press the
  // record, slide left for the next track or right for the previous, release.
  /** Where the press landed, in screen pixels. */
  const swipeFrom = useRef<{ x: number; y: number } | null>(null)
  /** Where the record is held, in metres. */
  const swipeHeld = useRef(0)
  const swipeDragging = useRef(false)
  /** Set once the press has travelled far enough to stop being a click. */
  const swiped = useRef(false)
  /** Where it actually is, easing home once the press ends. */
  const swipeNow = useRef(0)

  const maxAnisotropy = useThree((state) => state.gl.capabilities.getMaxAnisotropy())

  const albumArt = useAlbumArtTexture(albumArtUrl)
  const fallback = useMemo(() => fallbackLabelTexture(), [])
  const surface = useMemo(() => vinylMaterial(maxAnisotropy), [maxAnisotropy])
  const label = useMemo(() => labelMaterial(albumArt ?? fallback), [albumArt, fallback])

  useEffect(() => () => label.dispose(), [label])

  useFrame((_, delta) => {
    const group = spinner.current
    if (!group) return

    const state = stateRef.current

    // Spin up and down with weight. Spec §10: "Never an instant stop."
    // Held as degrees per second rather than rpm so the integration below is
    // a straight multiply against delta.
    const target = state.isPlaying
      ? state.platterRpm > 0
        ? state.platterRpm * 6
        : PLATTER_DEG_PER_SEC
      : 0
    degPerSec.current = damp(degPerSec.current, target, state.isPlaying ? 1.8 : 1.1, delta)

    if (degPerSec.current > 0.05) {
      // Clockwise from above, which in three's right-handed frame is negative y.
      group.rotation.y -= degPerSec.current * DEG * delta
    }

    // Held where the hand has it while the press lasts, eased home after --
    // damping during the drag would put the record behind the pointer, which
    // reads as lag rather than as weight.
    swipeNow.current = swipeDragging.current
      ? swipeHeld.current
      : damp(swipeNow.current, 0, 9, delta)
    group.position.x = swipeNow.current
  })

  /**
   * Start a swipe, and follow it on the *window*.
   *
   * Not on the mesh. A throw worth 90 pixels leaves a record a few hundred
   * across long before the release, and once the pointer is off it the mesh
   * stops hearing: measured, a drag from the record out past its rim landed
   * two moves and no release at all, and the distance it did report was
   * nonsense gathered from a later pass back over the disc. R3F's pointer
   * capture did not hold it -- `event.target.setPointerCapture` is the
   * pattern the arm drag uses, and it has the same hole.
   *
   * The window hears everything, so the gesture finishes wherever the hand
   * ends up, which is also what stops a half-finished drag leaving the record
   * held off-centre.
   */
  const beginSwipe = (x: number, y: number) => {
    swipeFrom.current = { x, y }
    swipeDragging.current = true
    swiped.current = false

    const move = (event: PointerEvent) => {
      const from = swipeFrom.current
      if (!from) return
      const dx = event.clientX - from.x
      const dy = event.clientY - from.y
      if (!isSwipeDrag(dx, dy)) return
      swiped.current = true
      swipeHeld.current = toMetres(swipeOffset(dx))
    }

    const up = (event: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      const from = swipeFrom.current
      swipeFrom.current = null
      swipeDragging.current = false
      swipeHeld.current = 0
      if (!from) return
      const outcome = swipeOutcome(event.clientX - from.x, event.clientY - from.y)
      if (outcome === 'next') actions.next()
      else if (outcome === 'previous') actions.previous()
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  /**
   * Screen pixels into metres.
   *
   * The gesture is judged in pixels, because what matters is how far the hand
   * went; the record is drawn in metres, and how far it should visibly travel
   * is a matter of proportion rather than of millimetres. So the eased offset
   * is taken as a fraction of its own ceiling and spent against the record's
   * radius -- a full pull slides it half a radius, at any window size and
   * whatever the camera is doing.
   */
  const toMetres = (pixels: number) => (pixels / SWIPE_RUBBER_PX) * RECORD.RADIUS * 0.5

  return (
    <group position={[0, 0, 0]}>
      {/* Platter and slipmat. Static — only the record above them turns. */}
      <mesh position={[0, PLATTER.HEIGHT / 2, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[PLATTER.RADIUS, PLATTER.RADIUS * 0.96, PLATTER.HEIGHT, 96]} />
          <primitive object={chromeMaterial()} attach="material" />
        </mesh>
        <mesh position={[0, PLATTER.HEIGHT + PLATTER.MAT_THICKNESS / 2, 0]} receiveShadow>
          <cylinderGeometry
            args={[PLATTER.RADIUS * 0.99, PLATTER.RADIUS * 0.99, PLATTER.MAT_THICKNESS, 64]}
          />
          <primitive object={feltMaterial()} attach="material" />
        </mesh>

      <group ref={spinner}>
        {/* Rim and underside: plain black, none of the expensive detail. */}
        <mesh position={[0, RECORD_SURFACE_Y - RECORD.THICKNESS / 2, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[RECORD.RADIUS, RECORD.RADIUS, RECORD.THICKNESS, 192]} />
          <primitive object={vinylEdgeMaterial()} attach="material" />
        </mesh>

        {/* The playing surface, and the play/pause target.
            Spec §11: the disc is the click target, not the arm — the arm is
            thin and moving, which makes it a poor one. */}
        <mesh
          position={[0, RECORD_SURFACE_Y + 0.00002, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          receiveShadow
          onClick={(event) => {
            event.stopPropagation()
            // A drag ends in a click too, and a swipe that took the song away
            // must not also stop it.
            if (swiped.current) {
              swiped.current = false
              return
            }
            if (stateRef.current.isPlaying) actions.pause()
            else actions.play()
          }}
          onPointerDown={(event) => {
            event.stopPropagation()
            beginSwipe(event.nativeEvent.clientX, event.nativeEvent.clientY)
          }}
          onPointerOver={() => setCursor('pointer')}
          onPointerOut={() => setCursor('default')}
        >
          <circleGeometry args={[RECORD.RADIUS, 192]} />
          <primitive object={surface} attach="material" />
        </mesh>

        {/* Centre label — album art, or the red fallback. */}
        <mesh
          position={[0, RECORD_SURFACE_Y + 0.00006, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          receiveShadow
        >
          <circleGeometry args={[RECORD.LABEL_RADIUS, 96]} />
          <primitive object={label} attach="material" />
        </mesh>
      </group>

      {/* Spindle, which also plugs the label's centre hole. */}
      <mesh position={[0, RECORD_SURFACE_Y + 0.004, 0]} castShadow>
        <cylinderGeometry args={[RECORD.HOLE_RADIUS, RECORD.HOLE_RADIUS, 0.012, 24]} />
        <primitive object={chromeMaterial()} attach="material" />
      </mesh>
    </group>
  )
}
