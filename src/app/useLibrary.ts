/**
 * Playlists and the queue.
 *
 * Deliberately separate from `useSync`, which owns the frame loop, the local
 * clock and the 3–5s player poll. Nothing here joins that poll: every read is
 * triggered by the user opening a pane, and the results are cached for the
 * session. Spotify's rate limit is shared across everything the app does, and
 * a browser that refetched on a timer would spend it on screens nobody has
 * open.
 *
 * Layer note: this talks to the bridge, so it lives in `app/`. The skin never
 * sees any of it — the turntable receives one extra number, in CSS pixels,
 * saying how tall the bar is.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlaylistSummary, PlaylistTrack, QueueSnapshot } from '../core/contract.js'

export type Pane = 'none' | 'playlists' | 'queue'

export type Load<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'error'; message: string }

export type Library = {
  pane: Pane
  /** Click the button already showing to dismiss; the bar has no close button. */
  toggle(pane: 'playlists' | 'queue'): void
  close(): void

  playlists: Load<PlaylistSummary[]>
  /** Non-null while drilled into one playlist. */
  viewing: PlaylistSummary | null
  tracks: Load<PlaylistTrack[]>
  drillInto(playlist: PlaylistSummary): void
  back(): void

  queue: Load<QueueSnapshot>

  playPlaylist(playlist: PlaylistSummary): void
  /** Play one track inside a context — a single call rather than N skips. */
  playTrackIn(contextUri: string, trackUri: string): void
  enqueue(track: PlaylistTrack): void
  /** URI of whatever command is in flight, so one row can show it. */
  busyUri: string | null
  /** Last command failure, shown inline in the sheet. */
  error: string | null
  dismissError(): void
}

/**
 * How long to wait before confirming a command against the server.
 *
 * A context change takes a moment to propagate from Spotify's servers to the
 * desktop client, so an immediate poll would read the old state and the UI
 * would sit on stale values until the next scheduled poll. Short enough to
 * feel immediate, long enough to usually be true.
 */
const CONFIRM_DELAY_MS = 600

export function useLibrary(options: {
  /** False when the stored session predates the playlist scopes. */
  playlistsEnabled: boolean
  /** Current track, so an open queue pane can follow along. */
  trackId: string | null
  /** Pulls the player state forward after a command lands. */
  pollNow: () => Promise<void>
}): Library {
  const { playlistsEnabled, trackId, pollNow } = options

  const [pane, setPane] = useState<Pane>('none')
  const [playlists, setPlaylists] = useState<Load<PlaylistSummary[]>>({ status: 'idle' })
  const [viewing, setViewing] = useState<PlaylistSummary | null>(null)
  const [tracks, setTracks] = useState<Load<PlaylistTrack[]>>({ status: 'idle' })
  const [queue, setQueue] = useState<Load<QueueSnapshot>>({ status: 'idle' })
  const [busyUri, setBusyUri] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // A fetch that resolves after unmount must not write state, and a command in
  // flight must not strand the busy flag.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const loadPlaylists = useCallback(async () => {
    setPlaylists({ status: 'loading' })
    const result = await window.vuelta.getPlaylists()
    if (!alive.current) return
    setPlaylists(
      result.ok
        ? { status: 'ready', value: result.playlists }
        : { status: 'error', message: result.message },
    )
  }, [])

  const loadQueue = useCallback(async () => {
    const result = await window.vuelta.getQueue()
    if (!alive.current) return
    setQueue(
      result.ok
        ? { status: 'ready', value: result.queue }
        : { status: 'error', message: result.message },
    )
  }, [])

  const toggle = useCallback(
    (next: 'playlists' | 'queue') => {
      setError(null)
      if (pane === next) {
        setPane('none')
        return
      }
      setPane(next)

      // Playlists are fetched on first open only — the list changes rarely and
      // it is the expensive call. The queue is cheap and always worth a look.
      if (next === 'playlists' && playlistsEnabled) {
        setViewing(null)
        if (playlists.status === 'idle' || playlists.status === 'error') void loadPlaylists()
      }
      if (next === 'queue') {
        // Only the spinner here. The fetch belongs to the effect below, which
        // already runs on every change of `pane` — doing it in both places
        // spent two requests on every open of the pane.
        if (queue.status !== 'ready') setQueue({ status: 'loading' })
      }
    },
    [pane, playlists.status, queue.status, loadPlaylists, playlistsEnabled],
  )

  const close = useCallback(() => {
    setPane('none')
    setError(null)
  }, [])

  const drillInto = useCallback((playlist: PlaylistSummary) => {
    setViewing(playlist)
    setTracks({ status: 'loading' })
    void (async () => {
      const result = await window.vuelta.getPlaylistTracks(playlist.playlistId)
      if (!alive.current) return
      setTracks(
        result.ok
          ? { status: 'ready', value: result.tracks }
          : { status: 'error', message: result.message },
      )
    })()
  }, [])

  const back = useCallback(() => {
    setViewing(null)
    setTracks({ status: 'idle' })
  }, [])

  /** Every write goes through here, so busy state and errors behave alike. */
  const run = useCallback(
    (uri: string, command: () => Promise<{ ok: boolean; message?: string }>) => {
      setBusyUri(uri)
      setError(null)
      void (async () => {
        const result = await command()
        if (!alive.current) return
        if (!result.ok) {
          setBusyUri(null)
          setError(result.message ?? 'Spotify refused that.')
          return
        }
        // Give the command time to reach the desktop client before believing
        // the player state, then let the normal poll cadence take over.
        window.setTimeout(() => {
          void pollNow().finally(() => {
            if (alive.current) setBusyUri(null)
          })
        }, CONFIRM_DELAY_MS)
      })()
    },
    [pollNow],
  )

  const playPlaylist = useCallback(
    (playlist: PlaylistSummary) => {
      run(playlist.uri, () => window.vuelta.playContext(playlist.uri))
      setPane('none')
    },
    [run],
  )

  const playTrackIn = useCallback(
    (contextUri: string, trackUri: string) => {
      run(trackUri, () => window.vuelta.playContext(contextUri, trackUri))
      setPane('none')
    },
    [run],
  )

  const enqueue = useCallback(
    (track: PlaylistTrack) => {
      // Stays open: queueing several in a row is the normal gesture.
      run(track.uri, () => window.vuelta.addToQueue(track.uri))
    },
    [run],
  )

  // Follow the track while the queue pane is open — the queue is exactly what
  // changes when a track ends. Closed, it is not refetched at all.
  useEffect(() => {
    if (pane !== 'queue') return
    void loadQueue()
  }, [pane, trackId, loadQueue])

  const dismissError = useCallback(() => setError(null), [])

  return {
    pane,
    toggle,
    close,
    playlists,
    viewing,
    tracks,
    drillInto,
    back,
    queue,
    playPlaylist,
    playTrackIn,
    enqueue,
    busyUri,
    error,
    dismissError,
  }
}
