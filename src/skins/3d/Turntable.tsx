/**
 * The 3D skin.
 *
 * Spec §5's architecture diagram lists a "future 3D skin" alongside the top
 * and console views, and says the boundary is "what makes a photoreal
 * renderer a swap rather than a rewrite". This is that skin.
 *
 * It knows nothing about Spotify, tokens, or HTTP. It receives a ref to the
 * current RenderState and renders it. That is the entire contract, and the
 * lint rules in eslint.config.mjs enforce it.
 */

import { Canvas } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Actions, RenderState } from '../../core/contract.js'
import { CAMERA } from './geometry/dimensions.js'
import { Cabinet } from './scene/Cabinet.js'
import { Lid } from './scene/Lid.js'
import { Record } from './scene/Record.js'
import { Staging } from './scene/Staging.js'
import { Tonearm } from './scene/Tonearm.js'
import { DEG, RenderStateProvider, type RenderStateRef } from './useFrameState.js'

export type TurntableProps = {
  /** Live state, mutated in place. Never a prop that changes per frame. */
  state: RenderStateRef
  /**
   * Structural: changing this loads a texture, so it is a real React prop
   * rather than something read inside the frame loop.
   */
  albumArtUrl: string | null
  /**
   * True while something is moving — playing, spinning down, or the lid is in
   * motion. Drives the render loop; see the note below.
   */
  active: boolean
  /** M3 wires these to disc-click and arm-drag. Unused by the read-only scene. */
  actions?: Actions
}

/** How long to keep rendering after things stop, so spin-down can finish. */
const SETTLE_MS = 2600

function cameraPosition(): [number, number, number] {
  const tilt = CAMERA.TILT_DEG * DEG
  return [
    CAMERA.TARGET_X,
    CAMERA.DISTANCE * Math.cos(tilt),
    CAMERA.DISTANCE * Math.sin(tilt),
  ]
}

export function Turntable({ state, albumArtUrl, active }: TurntableProps) {
  // This is a desktop app that spends most of its life idle. Rendering sixty
  // frames a second at a motionless record would burn GPU and battery for
  // nothing, so the loop drops to on-demand once everything has settled.
  const [loop, setLoop] = useState<'always' | 'demand'>('always')

  useEffect(() => {
    if (active) {
      setLoop('always')
      return
    }
    const timer = window.setTimeout(() => setLoop('demand'), SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [active])

  const position = useMemo(cameraPosition, [])

  return (
    <Canvas
      frameloop={loop}
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ position, fov: CAMERA.FOV, near: 0.05, far: 12 }}
      onCreated={({ camera }) => camera.lookAt(CAMERA.TARGET_X, 0, 0)}
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      <RenderStateProvider value={state}>
        <Staging />
        <Cabinet />
        <Record albumArtUrl={albumArtUrl} />
        <Tonearm />
        <Lid />
      </RenderStateProvider>
    </Canvas>
  )
}

/**
 * Convenience for callers that hold a plain RenderState rather than a ref.
 * Keeps the ref identity stable while mirroring the latest values into it, so
 * the scene still never re-renders on a progress tick.
 */
export function useRenderStateRefFrom(state: RenderState): RenderStateRef {
  const ref = useRef<RenderState>(state)
  ref.current = state
  return ref
}
