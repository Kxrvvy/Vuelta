/**
 * The browser bar: playlists and the queue.
 *
 * This is the feature that retired the spec's "mirror only, no playlist UI"
 * rule. The boundary that replaced it is narrow and worth stating: playlists
 * and the queue are browsable, and nothing else. No search, no albums, no
 * artists, no editing. Vuelta still shows what Spotify is playing — it just
 * lets you choose which record goes on.
 *
 * Shape: a thin strip of chrome at the bottom centre, and a sheet that rises
 * from it when a pane is open. The strip is summoned and dismissed with the
 * now-playing panel, by a click on the empty field around the machine; the
 * sheet is an overlay and may cover the machine, which is why the camera
 * reserves room for the strip only.
 */

import {
  VIEWS,
  type Actions,
  type PlaylistSummary,
  type PlaylistTrack,
  type VueltaView,
} from '../../core/contract.js'
import { mmss } from '../../core/format.js'
import type { Library, Load } from '../useLibrary.js'
import { Play } from '../transport/icons.js'

export function BrowserBar({
  ref,
  library,
  actions,
  visible,
  playlistsEnabled,
  onReconnect,
  contextUri,
  view,
  onView,
}: {
  /** Measured by TopView so the camera can frame above the bar. */
  ref?: React.Ref<HTMLDivElement>
  library: Library
  actions: Actions
  visible: boolean
  /** False when the stored session predates the playlist scopes. */
  playlistsEnabled: boolean
  onReconnect: () => void
  /** What is playing from, so a queue row can jump inside it. */
  contextUri: string | null
  /** Which of the three looks is on. */
  view: VueltaView
  onView: (view: VueltaView) => void
}) {
  const { pane, toggle } = library

  // The bar has no close button of its own. Clicking the button that is
  // already lit dismisses the sheet, and so does Escape or a click on the
  // empty field, both of which TopView owns — it has to drop the chrome in
  // the same gesture, which this component cannot see.
  const barVisible = visible || pane !== 'none'

  return (
    <div className="browser">
      {pane !== 'none' ? (
        <section className="browser__sheet" aria-label={pane === 'queue' ? 'Queue' : 'Playlists'}>
          {library.error ? (
            <div className="browser__error">
              <span>{library.error}</span>
              <button type="button" className="link" onClick={library.dismissError}>
                Dismiss
              </button>
            </div>
          ) : null}

          {pane === 'playlists' ? (
            playlistsEnabled ? (
              <PlaylistPane library={library} contextUri={contextUri} />
            ) : (
              <StaleScopes onReconnect={onReconnect} />
            )
          ) : (
            <QueuePane library={library} actions={actions} contextUri={contextUri} />
          )}
        </section>
      ) : null}

      <div
        ref={ref}
        className="browser__bar"
        data-visible={barVisible ? 'true' : 'false'}
        style={{ pointerEvents: barVisible ? 'auto' : 'none' }}
      >
        <button
          type="button"
          aria-label="Playlists"
          aria-pressed={pane === 'playlists'}
          data-active={pane === 'playlists' ? 'true' : 'false'}
          onClick={() => toggle('playlists')}
        >
          <span aria-hidden>☰</span> Playlists
        </button>
        <button
          type="button"
          aria-label="Queue"
          aria-pressed={pane === 'queue'}
          data-active={pane === 'queue' ? 'true' : 'false'}
          onClick={() => toggle('queue')}
        >
          <span aria-hidden>⊕</span> Queue
        </button>

        {/* The three looks. Same pill as the panes, because they are the same
            kind of thing to reach for -- but a rule between them, because one
            pair opens something and the other changes what you are looking
            at. Keys 1/2/3 do this without the chrome, in Stage.tsx. */}
        <span className="browser__divider" aria-hidden />
        <div className="browser__views" role="group" aria-label="View">
          {VIEWS.map((option, index) => (
            <button
              key={option.id}
              type="button"
              className="browser__view"
              aria-pressed={view === option.id}
              title={`${option.label} (${index + 1})`}
              data-active={view === option.id ? 'true' : 'false'}
              onClick={() => onView(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * The reconnect prompt.
 *
 * A session issued before the playlist scopes were asked for can poll the
 * player perfectly well and will fail every playlist read. Saying so is the
 * difference between a one-click fix and an error that looks like a bug.
 */
function StaleScopes({ onReconnect }: { onReconnect: () => void }) {
  return (
    <div className="browser__notice">
      <p>
        Your Spotify session was set up before Vuelta could read playlists. Reconnect once to grant
        access — nothing else changes, and the queue works either way.
      </p>
      <button type="button" className="primary" onClick={onReconnect}>
        Reconnect
      </button>
    </div>
  )
}

/** Shared handling for the three non-ready states, so each pane stays short. */
function Pending<T>({ load, empty }: { load: Load<T>; empty: string }) {
  if (load.status === 'loading' || load.status === 'idle') {
    return <p className="browser__muted">Loading…</p>
  }
  if (load.status === 'error') return <p className="browser__muted">{load.message}</p>
  return <p className="browser__muted">{empty}</p>
}

function PlaylistPane({
  library,
  contextUri,
}: {
  library: Library
  contextUri: string | null
}) {
  const { playlists, viewing, tracks, drillInto, back, playPlaylist, playTrackIn, enqueue, busyUri } =
    library

  if (viewing) {
    return (
      <>
        <header className="browser__head">
          <button type="button" className="link" onClick={back}>
            ← Playlists
          </button>
          <span className="browser__head-title">{viewing.name}</span>
          <button type="button" className="link" onClick={() => playPlaylist(viewing)}>
            Play all
          </button>
        </header>

        {tracks.status === 'ready' && tracks.value.length > 0 ? (
          <ul className="browser__list">
            {tracks.value.map((track, index) => (
              <TrackRow
                // A playlist can legitimately hold the same track twice, so the
                // URI alone is not a key.
                key={`${track.uri}-${index}`}
                track={track}
                busy={busyUri === track.uri}
                onPlay={() => playTrackIn(viewing.uri, track.uri)}
                onQueue={() => enqueue(track)}
              />
            ))}
          </ul>
        ) : (
          <Pending load={tracks} empty="Nothing in this playlist." />
        )}
      </>
    )
  }

  if (playlists.status !== 'ready' || playlists.value.length === 0) {
    return (
      <>
        <header className="browser__head">
          <span className="browser__head-title">Playlists</span>
        </header>
        <Pending load={playlists} empty="No playlists on this account." />
      </>
    )
  }

  return (
    <>
      <header className="browser__head">
        <span className="browser__head-title">Playlists</span>
      </header>
      <ul className="browser__list">
        {playlists.value.map((playlist) => (
          <PlaylistRow
            key={playlist.playlistId}
            playlist={playlist}
            playing={contextUri === playlist.uri}
            busy={busyUri === playlist.uri}
            onOpen={() => drillInto(playlist)}
            onPlay={() => playPlaylist(playlist)}
          />
        ))}
      </ul>
    </>
  )
}

function PlaylistRow({
  playlist,
  playing,
  busy,
  onOpen,
  onPlay,
}: {
  playlist: PlaylistSummary
  playing: boolean
  busy: boolean
  onOpen: () => void
  onPlay: () => void
}) {
  return (
    <li className="browser__row" data-playing={playing ? 'true' : 'false'}>
      {/* The row opens the playlist; the button plays it. The other way round
          would make every browse an interruption. */}
      <button type="button" className="browser__row-main" onClick={onOpen}>
        <span className="browser__cover">
          {playlist.coverUrl ? (
            <img src={playlist.coverUrl} alt="" draggable={false} />
          ) : (
            <span className="browser__cover--empty" />
          )}
        </span>
        <span className="browser__row-text">
          <span className="browser__row-title">{playlist.name}</span>
          <span className="browser__row-sub">
            {playlist.trackCount} {playlist.trackCount === 1 ? 'track' : 'tracks'}
            {playing ? ' · playing' : ''}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="browser__icon"
        aria-label={`Play ${playlist.name}`}
        disabled={busy}
        onClick={onPlay}
      >
        <Play />
      </button>
    </li>
  )
}

function TrackRow({
  track,
  busy,
  onPlay,
  onQueue,
}: {
  track: PlaylistTrack
  busy: boolean
  onPlay: () => void
  onQueue: () => void
}) {
  return (
    <li className="browser__row">
      <button type="button" className="browser__row-main" disabled={busy} onClick={onPlay}>
        <span className="browser__row-text">
          <span className="browser__row-title">{track.title}</span>
          <span className="browser__row-sub">{track.artist}</span>
        </span>
      </button>
      <span className="browser__row-time">{mmss(track.durationMs)}</span>
      <button
        type="button"
        className="browser__icon"
        aria-label={`Add ${track.title} to the queue`}
        disabled={busy}
        onClick={onQueue}
      >
        ⊕
      </button>
    </li>
  )
}

function QueuePane({
  library,
  actions,
  contextUri,
}: {
  library: Library
  actions: Actions
  contextUri: string | null
}) {
  const { queue, playTrackIn, busyUri } = library

  if (queue.status !== 'ready' || queue.value.items.length === 0) {
    return (
      <>
        <header className="browser__head">
          <span className="browser__head-title">Up next</span>
        </header>
        <Pending load={queue} empty="Nothing queued." />
      </>
    )
  }

  return (
    <>
      <header className="browser__head">
        <span className="browser__head-title">Up next</span>
      </header>
      <ul className="browser__list">
        {queue.value.items.map((track, index) => {
          // The first item is always reachable with a plain skip. Beyond that
          // the only single-call route is a context offset, which works for the
          // items that came from the playlist — most of them — and is refused
          // for one that was queued by hand. That refusal surfaces as an inline
          // message rather than as a storm of skip calls.
          const reachable = index === 0 || contextUri !== null
          return (
            <li key={`${track.uri}-${index}`} className="browser__row">
              <button
                type="button"
                className="browser__row-main"
                disabled={!reachable || busyUri === track.uri}
                onClick={() => {
                  if (index === 0) actions.next()
                  else if (contextUri) playTrackIn(contextUri, track.uri)
                }}
              >
                <span className="browser__row-index" aria-hidden>
                  {index + 1}
                </span>
                <span className="browser__row-text">
                  <span className="browser__row-title">{track.title}</span>
                  <span className="browser__row-sub">{track.artist}</span>
                </span>
              </button>
              <span className="browser__row-time">{mmss(track.durationMs)}</span>
            </li>
          )
        })}
      </ul>
    </>
  )
}
