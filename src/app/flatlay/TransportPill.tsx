/**
 * The flat-lay's chrome — spec §8.
 *
 * In `app/`, not in the skin, for the same reason the now-playing panel and
 * the browser bar are: the skin draws the scene, and the view decides what is
 * around it. A pill that reached into `useLibrary` from inside `skins/` would
 * break the boundary the lint zones exist to keep.
 *
 * It is permanent in this look, not summoned. The lyrics column set the
 * precedent: a column of chrome that *is* the content of a view does not fade
 * with the click gesture, and this pill is the only transport the flat-lay
 * has -- there is no machine in the scene to click.
 *
 * The browser bar is not drawn here, so its two jobs are picked up by this
 * pill: the library and queue buttons go to the machine and open the pane
 * there, where the sheet already works, and the round button at the corner
 * carries the view switcher. Without that last one the only way out of this
 * look would be the 1/2/3 keys.
 */

import { useEffect, useRef, useState } from 'react'

import { VIEWS, type Actions, type VueltaView } from '../../core/contract.js'

function SleeveIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <rect x="3.5" y="3.5" width="15" height="15" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="11" cy="11" r="3.4" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="11" cy="11" r="0.9" fill="currentColor" />
    </svg>
  )
}

function QueueIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <path
        d="M4 6h10M4 11h10M4 16h6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="16.5" cy="15.5" r="2.4" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

function PlayIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <rect x="5.5" y="4" width="3" height="12" rx="1" fill="currentColor" />
      <rect x="11.5" y="4" width="3" height="12" rx="1" fill="currentColor" />
    </svg>
  ) : (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <path d="M6.5 4.2v11.6L16 10 6.5 4.2Z" fill="currentColor" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M11 2.5v2M11 17.5v2M2.5 11h2M17.5 11h2M5 5l1.5 1.5M15.5 15.5 17 17M17 5l-1.5 1.5M6.5 15.5 5 17"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function TransportPill({
  title,
  artist,
  albumArtUrl,
  isPlaying,
  actions,
  view,
  onView,
  onBrowse,
  onSignOut,
}: {
  title: string | null
  artist: string | null
  albumArtUrl: string | null
  isPlaying: boolean
  actions: Actions
  view: VueltaView
  onView: (view: VueltaView) => void
  /** Go to the machine and open that pane, where the browser already lives. */
  onBrowse: (pane: 'playlists' | 'queue') => void
  onSignOut: () => void
}) {
  const [menu, setMenu] = useState<'none' | 'views' | 'settings'>('none')
  const root = useRef<HTMLDivElement | null>(null)

  // A menu that cannot be dismissed by clicking away is a trap, and the scene
  // behind it has its own click handlers.
  useEffect(() => {
    if (menu === 'none') return
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setMenu('none')
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu('none')
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  return (
    <div className="flatlay-chrome" ref={root}>
      {/* §8: a gear, top right. */}
      <button
        type="button"
        className="flatlay__gear"
        style={{ top: '26px', right: '26px' }}
        title="Settings"
        onClick={() => setMenu((was) => (was === 'settings' ? 'none' : 'settings'))}
      >
        <GearIcon />
      </button>

      {menu === 'settings' ? (
        <div className="flatlay__menu" style={{ top: '60px', right: '26px' }}>
          <span className="flatlay__menu-label">Vuelta</span>
          <button type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      ) : null}

      {/* §8: the transport pill, floating at bottom centre. */}
      <div className="flatlay__pill" style={{ bottom: '22px', height: '56px' }}>
        <button
          type="button"
          className="flatlay__pill-icon"
          title="Playlists"
          onClick={() => onBrowse('playlists')}
        >
          <SleeveIcon />
        </button>

        <div className="flatlay__pill-inner">
          <span className="flatlay__pill-glyph">
            {albumArtUrl ? <img src={albumArtUrl} alt="" /> : null}
          </span>
          <span className="flatlay__pill-meta">
            <span className="flatlay__pill-title">{title ?? 'Nothing playing'}</span>
            <span className="flatlay__pill-artist">{artist ?? '—'}</span>
          </span>
          <button
            type="button"
            className="flatlay__pill-play"
            title={isPlaying ? 'Pause' : 'Play'}
            onClick={() => (isPlaying ? actions.pause() : actions.play())}
          >
            <PlayIcon playing={isPlaying} />
          </button>
        </div>

        <button
          type="button"
          className="flatlay__pill-icon"
          title="Queue"
          onClick={() => onBrowse('queue')}
        >
          <QueueIcon />
        </button>
      </div>

      {/* §8: a standalone round button, far bottom right. It carries the view
          switcher, which the browser bar would otherwise have held. */}
      <button
        type="button"
        className="flatlay__round"
        style={{ bottom: '28px', right: '28px', width: '44px', height: '44px' }}
        title="View"
        onClick={() => setMenu((was) => (was === 'views' ? 'none' : 'views'))}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
          <circle cx="4.5" cy="10" r="1.6" fill="currentColor" />
          <circle cx="10" cy="10" r="1.6" fill="currentColor" />
          <circle cx="15.5" cy="10" r="1.6" fill="currentColor" />
        </svg>
      </button>

      {menu === 'views' ? (
        <div className="flatlay__menu" style={{ bottom: '82px', right: '28px' }}>
          <span className="flatlay__menu-label">View</span>
          {VIEWS.map((option) => (
            <button
              key={option.id}
              type="button"
              data-on={option.id === view}
              onClick={() => {
                onView(option.id)
                setMenu('none')
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
