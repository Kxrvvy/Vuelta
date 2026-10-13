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

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BrowserBar } from '../app/browser/BrowserBar.js'
import { NowPlayingPanel } from '../app/panel/NowPlayingPanel.js'
import type { Sync } from '../app/useSync.js'
import { useLibrary } from '../app/useLibrary.js'
import { toggleChrome } from '../core/chrome.js'
import { Turntable } from '../skins/3d/Turntable.js'

/** Gap between the machine and the chrome, matching the chrome's own inset. */
const GUTTER_PX = 18

/**
 * Measures how much of the right-hand edge an element is occupying, live.
 *
 * Measured from the window edge rather than from the element's own width, so
 * its margin is included without being counted twice.
 *
 * Only the panel needs this. The browser bar sits in the margin that exact
 * vertical centring already leaves beneath the machine, so the camera makes
 * no allowance for it — see the note at the end of fitCamera.
 */
function useEdgeReserve<T extends HTMLElement>(axis: 'right') {
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
  // Both pieces of chrome are summoned by a click on the empty field around
  // the machine, and dismissed by another one. See core/chrome.ts for why that
  // decision is not a plain negation of this flag.
  //
  // It starts shown every time the lid opens. Nothing advertises the gesture
  // now that pointer movement does not reveal anything, so the chrome shows
  // itself once and is taught by being clicked away.
  const [chromeShown, setChromeShown] = useState(true)

  const library = useLibrary({
    playlistsEnabled: !scopesStale,
    trackId: sync.track?.trackId ?? null,
    pollNow: sync.pollNow,
  })

  useEffect(() => {
    if (sync.lidOpen) setChromeShown(true)
  }, [sync.lidOpen])

  const paneOpen = library.pane !== 'none'
  const closePane = library.close

  const dismiss = useCallback(() => {
    // Nothing to summon in the closed-lid front view, which is bare by design.
    if (!sync.lidOpen) return
    const next = toggleChrome({ chromeShown, paneOpen })
    setChromeShown(next.chromeShown)
    if (next.closePane) closePane()
  }, [sync.lidOpen, chromeShown, paneOpen, closePane])

  // The same gesture from the keyboard. Escape used to live in BrowserBar and
  // close only the sheet; one key doing one thing is worth more than the sheet
  // owning its own dismissal.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dismiss])

  const panelShown = chromeShown && sync.lidOpen
  // The sheet holds the bar up on its own, so dismissing has to close it too.
  const barShown = (chromeShown || paneOpen) && sync.lidOpen

  const [panelRef, panelReserve] = useEdgeReserve<HTMLElement>('right')

  // Held steady for the length of a drag. Re-framing mid-gesture would slide
  // the tonearm's hit geometry away from the pointer still holding it.
  const live = panelShown ? panelReserve : 0
  const frozen = useRef(live)
  if (!sync.readout.isDragging) frozen.current = live
  const reserveRight = sync.readout.isDragging ? frozen.current : live

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
        reserveRightPx={reserveRight}
        lidOpen={sync.lidOpen}
        onOpenLid={sync.openLid}
        onCloseLid={sync.closeLid}
        onArmDragStart={sync.beginArmDrag}
        onArmDragTo={sync.dragToProgress}
        onArmDragEnd={sync.endArmDrag}
        onBackgroundClick={dismiss}
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
          library={library}
          actions={sync.actions}
          visible={barShown}
          playlistsEnabled={!scopesStale}
          onReconnect={onReconnect}
          contextUri={sync.readout.contextUri}
        />
      ) : null}
    </div>
  )
}
