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
import { LAYER } from './layers.js'
import { CameraRig } from './scene/CameraRig.js'
import { InteractionProvider, type SkinInteraction } from './interaction/context.js'
import { NeedleReadout } from './interaction/NeedleReadout.js'
import { Cabinet } from './scene/Cabinet.js'
import { OnLayer } from './scene/OnLayer.js'
import { Sleeve } from './scene/Sleeve.js'
import { Knob } from './scene/Knob.js'
import { Lid } from './scene/Lid.js'
import { OpenButton } from './scene/OpenButton.js'
import { Record } from './scene/Record.js'
import { Staging } from './scene/Staging.js'
import { TimeDisplay } from './scene/TimeDisplay.js'
import { Tonearm } from './scene/Tonearm.js'
import { Viewports } from './scene/Viewports.js'
import { RenderStateProvider, setCursor, type RenderStateRef } from './useFrameState.js'

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
  onOpenLid: () => void
  onCloseLid: () => void
  /** Drives the camera pose, so it has to be a React-visible value. */
  lidOpen: boolean
  onArmDragStart: () => void
  onArmDragTo: (progressMs: number) => void
  onArmDragEnd: () => void
  /** A click that landed on the empty field, not on the machine. */
  onBackgroundClick: () => void
  /**
   * How the scene is composed. `machine` frames the whole unit; `closeup`
   * fills the frame with the record and the arm and puts the machine in an
   * inset at the top left.
   */
  composition: 'machine' | 'closeup'
  /** CSS pixels the overlay panel occupies on the right, measured live. */
  reserveRightPx: number
}

/** How long to keep rendering after things stop, so spin-down can finish. */
const SETTLE_MS = 2600

export function Turntable({
  state,
  actions,
  albumArtUrl,
  volumePercent,
  active,
  onOpenLid,
  onCloseLid,
  lidOpen,
  onArmDragStart,
  onArmDragTo,
  onArmDragEnd,
  onBackgroundClick,
  composition,
  reserveRightPx,
}: TurntableProps) {
  // This is a desktop app that spends most of its life idle. Rendering sixty
  // frames a second at a motionless record would burn GPU and battery for
  // nothing, so the loop drops to on-demand once everything has settled.
  const [loop, setLoop] = useState<'always' | 'demand'>('always')
  const readoutRef = useRef<HTMLDivElement | null>(null)

  // The close-up only means anything with the lid up: the record is what it
  // frames, and with the lid shut the camera is round the front looking at a
  // closed box.
  const closeup = composition === 'closeup' && lidOpen
  const pose = !lidOpen ? 'front' : closeup ? 'closeup' : 'top'

  // Which of the two cards is on top. Skin-local and purely visual: it moves
  // nothing but the cover, and playback is untouched. It outlives a view
  // change, because Turntable stays mounted in all three looks, so coming back
  // to the flat-lay leaves the stack as you left it.
  const [coverInFront, setCoverInFront] = useState(false)

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

  const interaction = useMemo<SkinInteraction>(
    () => ({
      actions,
      openLid: onOpenLid,
      closeLid: onCloseLid,
      beginArmDrag: onArmDragStart,
      dragToProgress: onArmDragTo,
      endArmDrag: onArmDragEnd,
      readoutRef,
    }),
    [actions, onOpenLid, onCloseLid, onArmDragStart, onArmDragTo, onArmDragEnd],
  )

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas
        // A click that hits nothing in the scene. R3F raises this only when
        // the pointer moved two pixels or less, so a drag that ends over the
        // background is not one -- but it also counts a right-click and a
        // double-click as clicks, which would toggle the chrome from a context
        // menu and flip it three times from a double. Hence the guard.
        onPointerMissed={(event) => {
          if (event.type === 'click' && event.button === 0) onBackgroundClick()
        }}
        frameloop={loop}
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        // Position and look-at are owned by CameraRig, which refits them to
        // the window. Only the fixed optics are declared here.
        camera={{ fov: CAMERA.FOV, near: 0.05, far: 12 }}
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <RenderStateProvider value={state}>
          <InteractionProvider value={interaction}>
            <CameraRig reserveRightPx={reserveRightPx} pose={pose} />
            <Viewports inset={closeup} />
            <Staging />

            {/* The machine. Absent from the flat-lay, which is a record and a
                sleeve lying on a surface and nothing else -- but still drawn
                in that view's inset, which is why this is a layer and not a
                condition on mounting. */}
            <OnLayer value={LAYER.MACHINE}>
              <Cabinet />
              <TimeDisplay lidOpen={lidOpen} />
              <Knob volumePercent={volumePercent} />
              <Lid />
              <OpenButton lidOpen={lidOpen} />
            </OnLayer>

            {/* The record and the arm, which every view has. */}
            <Record albumArtUrl={albumArtUrl} />
            <Tonearm />

            {/* And the sleeve, which only the flat-lay has. */}
            <OnLayer value={LAYER.FLATLAY}>
              <Sleeve
                albumArtUrl={albumArtUrl}
                inFront={coverInFront}
                onToggle={() => setCoverInFront((was) => !was)}
              />
            </OnLayer>

            <NeedleReadout />
          </InteractionProvider>
        </RenderStateProvider>
      </Canvas>

      {/* No hit target over the inset, on purpose.
          The little machine is a picture: none of its controls work and
          clicking it does not change view. It is on the MACHINE layer, which
          the flat-lay camera does not see, and the raycaster follows that
          camera -- so a click there reaches nothing and is treated as the
          empty field, which is the gesture that summons or dismisses the
          chrome. That is the right answer for a corner that holds nothing
          clickable. */}

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
