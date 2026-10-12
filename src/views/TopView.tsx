/**
 * View A — spec §12. "Camera overhead. Disc and tonearm fill the window."
 *
 * Composes the 3D skin with the now-playing overlay. `views/` exists for
 * exactly this (spec §15): the skin draws, the view decides what is on screen
 * alongside it. M5's console view becomes a sibling of this file rather than
 * a rewrite of it.
 *
 * It also owns the one number both halves need: how much of the right-hand
 * side the panel is using. CSS sizes the panel and the camera has to frame
 * around it, so the value is *measured* rather than written down twice — a
 * hard-coded copy would drift the first time either side changed.
 */

import { useLayoutEffect, useRef, useState } from 'react'
import { NowPlayingPanel, usePointerActivity } from '../app/panel/NowPlayingPanel.js'
import type { Sync } from '../app/useSync.js'
import { Turntable } from '../skins/3d/Turntable.js'

/** Gap between the machine and the panel, matching the panel's own inset. */
const GUTTER_PX = 18

export function TopView({ sync }: { sync: Sync }) {
  const pointerAwake = usePointerActivity()

  // A drag keeps the panel up even if the pointer goes still. That is exactly
  // when the floating timestamp matters most, and it stops the camera moving
  // under a cursor that is mid-gesture — see the frozen reserve below.
  const panelShown = (pointerAwake || sync.readout.isDragging) && sync.lidOpen
  const panelRef = useRef<HTMLElement | null>(null)
  const [reserveRightPx, setReserveRightPx] = useState(0)

  useLayoutEffect(() => {
    const element = panelRef.current
    if (!element) return

    const measure = () => {
      const rect = element.getBoundingClientRect()
      // Measured from the right edge of the window, not the panel's own
      // width, so the panel's margin is included without being duplicated.
      const reserved = window.innerWidth - rect.left + GUTTER_PX
      setReserveRightPx(Math.max(0, Math.round(reserved)))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  // Held steady for the length of a drag. Re-framing mid-gesture would slide
  // the tonearm's hit geometry away from the pointer still holding it.
  const live = panelShown ? reserveRightPx : 0
  const frozen = useRef(live)
  if (!sync.readout.isDragging) frozen.current = live
  const reserve = sync.readout.isDragging ? frozen.current : live

  return (
    <div className="stage">
      <Turntable
        state={sync.stateRef}
        actions={sync.actions}
        albumArtUrl={sync.track?.albumArtUrl ?? null}
        volumePercent={sync.readout.volumePercent}
        active={sync.active}
        // Only reserve room while the panel is actually drawn, so the machine
        // sits centred the moment it fades. The rect is still measured
        // whatever the opacity; it is the gating that is conditional.
        reserveRightPx={reserve}
        lidOpen={sync.lidOpen}
        onOpenLid={sync.openLid}
        onCloseLid={sync.closeLid}
        onArmDragStart={sync.beginArmDrag}
        onArmDragTo={sync.dragToProgress}
        onArmDragEnd={sync.endArmDrag}
      />

      <NowPlayingPanel
        ref={panelRef}
        track={sync.track}
        progressMs={sync.readout.progressMs}
        durationMs={sync.readout.durationMs}
        isPlaying={sync.readout.isPlaying}
        volumePercent={sync.readout.volumePercent}
        deviceName={sync.readout.deviceName}
        actions={sync.actions}
        visible={panelShown}
      />
    </div>
  )
}
