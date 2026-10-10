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
import { useEffect, useMemo, useRef, useState } from 'react'
import { type Group, SRGBColorSpace, type Texture, TextureLoader } from 'three'
import { PLATTER, PLATTER_DEG_PER_SEC, RECORD, RECORD_SURFACE_Y } from '../geometry/dimensions.js'
import {
  chromeMaterial,
  feltMaterial,
  labelMaterial,
  vinylEdgeMaterial,
  vinylMaterial,
} from '../materials/surfaces.js'
import { fallbackLabelTexture } from '../materials/textures.js'
import { DEG, damp, useRenderStateRef } from '../useFrameState.js'

/**
 * Load album art as a texture.
 *
 * `crossOrigin` matters: the art comes from i.scdn.co, which the packaged CSP
 * permits under `img-src`. Without CORS the texture would taint and fail.
 */
function useAlbumArtTexture(url: string | null): Texture | null {
  const [texture, setTexture] = useState<Texture | null>(null)

  useEffect(() => {
    if (!url) {
      setTexture(null)
      return
    }

    let cancelled = false
    const loader = new TextureLoader()
    loader.setCrossOrigin('anonymous')
    loader.load(
      url,
      (loaded) => {
        if (cancelled) {
          loaded.dispose()
          return
        }
        loaded.colorSpace = SRGBColorSpace
        setTexture(loaded)
      },
      undefined,
      () => {
        // A failed load is not worth an error screen — the red label is a
        // perfectly good fallback and the next track will try again.
        if (!cancelled) setTexture(null)
      },
    )

    return () => {
      cancelled = true
    }
  }, [url])

  useEffect(() => () => texture?.dispose(), [texture])

  return texture
}

export function Record({ albumArtUrl }: { albumArtUrl: string | null }) {
  const stateRef = useRenderStateRef()
  const spinner = useRef<Group>(null)
  const degPerSec = useRef(0)

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
  })

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

        {/* The playing surface. A separate disc so the groove, roughness and
            anisotropy maps apply only where they are actually visible. */}
        <mesh
          position={[0, RECORD_SURFACE_Y + 0.00002, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          receiveShadow
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
