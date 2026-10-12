/**
 * View A — spec §12. "Camera overhead. Disc and tonearm fill the window."
 *
 * Composes the 3D skin with the now-playing overlay and the browser bar.
 * `views/` exists for exactly this (spec §15): the skin draws, the view decides
 * what is on screen alongside it. M5's console view becomes a sibling of this
 * file rather than a rewrite of it.
 *
 * It also owns the two numbers both halves need: how much of the right-hand
 * side the panel is using, and how much of the bottom the bar is. CSS sizes
 * both and the camera has to frame around them, so the values are *measured*
 * rather than written down twice — a hard-coded copy would drift the first time
 * either side changed.
 */

import { useLayoutEffect, useRef, useState } from 'react'
import { BrowserBar } from '../app/browser/BrowserBar.js'
import { NowPlayingPanel, usePointerActivity } from '../app/panel/NowPlayingPanel.js'
import type { Sync } from '../app/useSync.js'
import { useLibrary } from '../app/useLibrary.js'
import { Turntable } from '../skins/3d/Turntable.js'

/** Gap between the machine and the chrome, matching the chrome's own inset. */
const GUTTER_PX = 18

/**
 * Measures how much of an edge an element is occupying, live.
 *
 * Shared by the panel and the bar because they ask the same question of
 * different axes: how far in from the edge does this thing start? Measured
 * from the window edge rather than from the element's own width, so its margin
 * is included without being counted twice.
 */
function useEdgeReserve<T extends HTMLElement>(axis: 'right' | 'bottom') {
  // A callback ref rather than useRef, so the measurement restarts when the
  // element itself comes or goes. The bar is only mounted while the lid is
  // open, and a useRef would have been null on the pass that set up the
  // observer — leaving the reserve stuck at zero for the first lid-open, and
  // watching a detached node after the second.
  const [element, setElement] = useState<T | null>(null)
  const [reserve, setReserve] = useState(0)

  useLayoutEffect(() => {
    if (!element) return

    const measure = () => {
      const rect = element.getBoundingClientRect()
      const reserved =
        axis === 'right' ? window.innerWidth - rect.left : window.innerHeight - rect.top
      setReserve(Math.max(0, Math.round(reserved + GUTTER_PX)))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [axis, element])

  return [setElement, reserve] as const
}

export function TopView({
  sync,
  scopesStale,
  onReconnect,
}: {
  sync: Sync
  /** The stored session was granted fewer scopes than Vuelta now asks for. */
  scopesStale: boolean
  onReconnect: () => void
}) {
  const pointerAwake = usePointerActivity()

  const library = useLibrary({
    playlistsEnabled: !scopesStale,
    trackId: sync.track?.trackId ?? null,
    pollNow: sync.pollNow,
  })

  // A drag keeps the panel up even if the pointer goes still. That is exactly
  // when the floating timestamp matters most, and it stops the camera moving
  // under a cursor that is mid-gesture — see the frozen reserve below.
  const panelShown = (pointerAwake || sync.readout.isDragging) && sync.lidOpen
  const [panelRef, panelReserve] = useEdgeReserve<HTMLElement>('right')
  const [barRef, barReserve] = useEdgeReserve<HTMLDivElement>('bottom')

  // Held steady for the length of a drag. Re-framing mid-gesture would slide
  // the tonearm's hit geometry away from the pointer still holding it.
  const live = panelShown ? panelReserve : 0
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
        // Gated on the lid alone, deliberately unlike the panel. `targetY`
        // rides the slow pose rate because it carries the lid arc, so a reserve
        // that came and went on the idle timer would read as a vertical drift.
        // The strip is thin, so holding it costs little; the bar fades within
        // the room already set aside for it.
        reserveBottomPx={sync.lidOpen ? barReserve : 0}
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

      {/* Lid shut is the front pose, which is bare by design — no chrome at
          all until the machine is open. */}
      {sync.lidOpen ? (
        <BrowserBar
          ref={barRef}
          library={library}
          actions={sync.actions}
          visible={pointerAwake}
          playlistsEnabled={!scopesStale}
          onReconnect={onReconnect}
          contextUri={sync.readout.contextUri}
        />
      ) : null}
    </div>
  )
}
