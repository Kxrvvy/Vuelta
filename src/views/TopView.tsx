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
  const awake = usePointerActivity()
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

  return (
    <div className="stage">
      <Turntable
        state={sync.stateRef}
        actions={sync.actions}
        albumArtUrl={sync.track?.albumArtUrl ?? null}
        volumePercent={sync.readout.volumePercent}
        active={sync.active}
        reserveRightPx={reserveRightPx}
        onToggleLid={sync.toggleLid}
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
        visible={awake}
      />
    </div>
  )
}
