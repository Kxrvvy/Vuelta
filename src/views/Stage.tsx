/**
 * The stage: the machine, and whatever is on screen beside it.
 *
 * `views/` exists for exactly this (spec §15): the skin draws, the view decides
 * what is around it. There are three looks, and they share this one file
 * rather than being three sibling components, because the chrome gesture, the
 * library, the camera reserve and the Turntable itself are common to all
 * three — triplicating them is how two of the three fall behind.
 *
 *   main     spec §12's View A, unchanged: the whole machine, centred.
 *   lyrics   the machine to the left, a column of synced lyrics beside it.
 *   closeup  a different skin entirely -- a sleeve and a record lying on
 *            paper, drawn in DOM, with the machine shrunk to a preview in
 *            the top-left corner.
 *
 * It also owns the two numbers both halves need: how much of the right-hand
 * side the panel is using, and how much of the bottom the bar is. CSS sizes
 * both and the camera has to frame around them, so the values are *measured*
 * rather than written down twice — a hard-coded copy would drift the first time
 * either side changed.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BrowserBar } from '../app/browser/BrowserBar.js'
import { LyricsColumn } from '../app/lyrics/LyricsColumn.js'
import { useLyrics } from '../app/lyrics/useLyrics.js'
import { NowPlayingPanel } from '../app/panel/NowPlayingPanel.js'
import type { Sync } from '../app/useSync.js'
import { useLibrary } from '../app/useLibrary.js'
import { toggleChrome } from '../core/chrome.js'
import { VIEWS, type VueltaView } from '../core/contract.js'
import { FlatLay } from '../skins/flatlay/FlatLay.js'
import { Turntable } from '../skins/3d/Turntable.js'

/** Gap between the machine and the chrome, matching the chrome's own inset. */
const GUTTER_PX = 18

/**
 * Measures how much of the right-hand edge an element is occupying, live.
 *
 * Measured from the window edge rather than from the element's own width, so
 * its margin is included without being counted twice.
 *
 * Used by whichever column holds the right edge: the now-playing panel in the
 * main and close-up looks, the lyrics column in the lyrics one. The browser
 * bar sits in the margin that exact vertical centring already leaves beneath
 * the machine, so the camera makes no allowance for it — see the note at the
 * end of fitCamera.
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

export function Stage({
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

  // Session-only, and it starts on Main every launch. Persisting a look means
  // a config field and an IPC round trip for a preference; not worth it yet.
  const [view, setView] = useState<VueltaView>('main')

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

  // The flat-lay is a separate skin, and the machine is only a thumbnail in
  // it -- so, like the close-up before it, it only means anything with the lid
  // up. With the
  // lid shut the front pose is what you get, in every look, which is what
  // keeps "closing the lid is the stop gesture" true here too.
  const flatlayShown = view === 'closeup' && sync.lidOpen

  // Only while the view is actually on: nothing about the track is sent
  // anywhere in the other two looks.
  const lyrics = useLyrics({ enabled: view === 'lyrics', track: sync.track })

  const dismiss = useCallback(() => {
    // Nothing to summon in the closed-lid front view, which is bare by design.
    if (!sync.lidOpen) return
    const next = toggleChrome({ chromeShown, paneOpen })
    setChromeShown(next.chromeShown)
    if (next.closePane) closePane()
  }, [sync.lidOpen, chromeShown, paneOpen, closePane])

  // The same gesture from the keyboard, plus 1/2/3 for the three looks. The
  // keys work whether or not the chrome is up, which is the point: the switch
  // in the bar needs the chrome summoned first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dismiss()
        return
      }
      if (event.ctrlKey || event.altKey || event.metaKey) return
      const picked = VIEWS.find((_, index) => event.key === String(index + 1))
      if (picked) setView(picked.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dismiss])

  // The lyrics column takes the right edge in place of the panel, and keeps
  // it: it is the content of that view, not chrome over it, so it does not
  // fade with the pointer gesture. The closed-lid front view stays bare in
  // every look, which is why the lid gates this too.
  const lyricsShown = view === 'lyrics' && sync.lidOpen
  const panelShown = chromeShown && sync.lidOpen && !lyricsShown && !flatlayShown
  // The sheet holds the bar up on its own, so dismissing has to close it too.
  // One bar for all three looks, summoned and dismissed by the same gesture —
  // the flat-lay had a transport pill of its own for a while, and two pieces
  // of chrome doing one job is one too many.
  const barShown = (chromeShown || paneOpen) && sync.lidOpen

  // The settings corner lives in the shell, which wraps the screen switch and
  // so sits above this — it cannot be handed a prop. The flag goes on the
  // document and the stylesheet picks it up, so the corner comes and goes with
  // the browser bar instead of sitting over a dismissed scene on its own.
  useEffect(() => {
    document.body.dataset.chrome = barShown ? 'shown' : 'hidden'
    return () => {
      delete document.body.dataset.chrome
    }
  }, [barShown])

  // One measurement for whichever column is mounted. The hook takes a
  // callback ref precisely so it can follow the swap.
  const [rightRef, rightReserve] = useEdgeReserve<HTMLElement>('right')

  // Held steady for the length of a drag. Re-framing mid-gesture would slide
  // the tonearm's hit geometry away from the pointer still holding it.
  const live = (lyricsShown && !flatlayShown) || panelShown ? rightReserve : 0
  const frozen = useRef(live)
  if (!sync.readout.isDragging) frozen.current = live
  const reserveRight = sync.readout.isDragging ? frozen.current : live

  return (
    <div className="stage">
      {/* Never unmounted. Tearing the Canvas down would throw away the
          generated environment map and every texture, and rebuild both on the
          way back.

          Under the flat-lay it used to be `display: none`. Now it shrinks into
          the top-left corner instead and becomes the preview of the machine --
          which is the same canvas, the same camera and the same lid, just
          given a small box to frame itself in. That is why there is no second
          viewport and no second scene: the only thing that changes is the size
          of the element the renderer is already drawing into. */}
      <div className={flatlayShown ? 'stage__machine stage__machine--preview' : 'stage__machine'}>
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
      </div>

      {flatlayShown ? (
        <FlatLay
          state={sync.stateRef}
          actions={sync.actions}
          albumArtUrl={sync.display.albumArtUrl}
          title={sync.display.title}
          artist={sync.display.artist}
          onArmDragStart={sync.beginArmDrag}
          onArmDragTo={sync.dragToProgress}
          onArmDragEnd={sync.endArmDrag}
          onBackgroundClick={dismiss}
        />
      ) : null}

      {lyricsShown && !flatlayShown ? (
        <LyricsColumn
          ref={rightRef}
          load={lyrics}
          track={sync.track}
          isPlaying={sync.readout.isPlaying}
          stateRef={sync.stateRef}
          actions={sync.actions}
        />
      ) : flatlayShown ? null : (
        <NowPlayingPanel
          ref={rightRef}
          track={sync.track}
          progressMs={sync.readout.progressMs}
          durationMs={sync.readout.durationMs}
          isPlaying={sync.readout.isPlaying}
          volumePercent={sync.readout.volumePercent}
          deviceName={sync.readout.deviceName}
          actions={sync.actions}
          visible={panelShown}
        />
      )}

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
          view={view}
          onView={setView}
        />
      ) : null}
    </div>
  )
}
