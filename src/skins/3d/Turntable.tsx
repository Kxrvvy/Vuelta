/**
 * The 3D skin.
 *
 * Spec §5's architecture diagram lists a "future 3D skin" alongside the top
 * and console views, and says the boundary is "what makes a photoreal
 * renderer a swap rather than a rewrite". This is that skin.
 *
 * It knows nothing about Spotify, tokens, or HTTP. It receives a ref to the
 * current RenderState and an `Actions` object, and renders one and calls the
 * other. The lint rules in eslint.config.mjs enforce that.
 */

import { Canvas } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Actions } from '../../core/contract.js'
import { CAMERA } from './geometry/dimensions.js'
import { InteractionProvider, type SkinInteraction } from './interaction/context.js'
import { NeedleReadout } from './interaction/NeedleReadout.js'
import { Cabinet } from './scene/Cabinet.js'
import { Knob } from './scene/Knob.js'
import { Lid } from './scene/Lid.js'
import { Record } from './scene/Record.js'
import { Staging } from './scene/Staging.js'
import { Tonearm } from './scene/Tonearm.js'
import { DEG, RenderStateProvider, setCursor, type RenderStateRef } from './useFrameState.js'

export type TurntableProps = {
  /** Live state, mutated in place. Never a prop that changes per frame. */
  state: RenderStateRef
  actions: Actions
  /** Structural: changing this loads a texture, so it earns a real render. */
  albumArtUrl: string | null
  /** Structural: drives the knob when the value comes from elsewhere. */
  volumePercent: number | null
  /** True while something is moving. Drives the render loop. */
  active: boolean
  onToggleLid: () => void
  onArmDragStart: () => void
  onArmDragTo: (progressMs: number) => void
  onArmDragEnd: () => void
}

/** How long to keep rendering after things stop, so spin-down can finish. */
const SETTLE_MS = 2600

function cameraPosition(): [number, number, number] {
  const tilt = CAMERA.TILT_DEG * DEG
  return [CAMERA.TARGET_X, CAMERA.DISTANCE * Math.cos(tilt), CAMERA.DISTANCE * Math.sin(tilt)]
}

export function Turntable({
  state,
  actions,
  albumArtUrl,
  volumePercent,
  active,
  onToggleLid,
  onArmDragStart,
  onArmDragTo,
  onArmDragEnd,
}: TurntableProps) {
  // This is a desktop app that spends most of its life idle. Rendering sixty
  // frames a second at a motionless record would burn GPU and battery for
  // nothing, so the loop drops to on-demand once everything has settled.
  const [loop, setLoop] = useState<'always' | 'demand'>('always')
  const readoutRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (active) {
      setLoop('always')
      return
    }
    const timer = window.setTimeout(() => setLoop('demand'), SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [active])

  // Leaving a 'grabbing' or 'pointer' cursor behind after unmount would be
  // inherited by whatever screen comes next.
  useEffect(() => () => setCursor('default'), [])

  const position = useMemo(cameraPosition, [])

  const interaction = useMemo<SkinInteraction>(
    () => ({
      actions,
      toggleLid: onToggleLid,
      beginArmDrag: onArmDragStart,
      dragToProgress: onArmDragTo,
      endArmDrag: onArmDragEnd,
      readoutRef,
    }),
    [actions, onToggleLid, onArmDragStart, onArmDragTo, onArmDragEnd],
  )

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
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
          <InteractionProvider value={interaction}>
            <Staging />
            <Cabinet />
            <Knob volumePercent={volumePercent} />
            <Record albumArtUrl={albumArtUrl} />
            <Tonearm />
            <Lid />
            <NeedleReadout />
          </InteractionProvider>
        </RenderStateProvider>
      </Canvas>

      {/* The floating timestamp. Real DOM for real text rendering; positioned
          every frame by NeedleReadout writing straight to this element. */}
      <div
        ref={readoutRef}
        aria-hidden
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          opacity: 0,
          pointerEvents: 'none',
          transform: 'translate3d(-999px, -999px, 0)',
          marginLeft: '14px',
          marginTop: '-10px',
          padding: '2px 7px',
          borderRadius: '4px',
          background: 'rgba(12,10,9,0.88)',
          border: '1px solid #2e2823',
          color: '#e8e2d9',
          font: '12px "Cascadia Mono", Consolas, monospace',
          letterSpacing: '0.04em',
          willChange: 'transform',
        }}
      />
    </div>
  )
}
