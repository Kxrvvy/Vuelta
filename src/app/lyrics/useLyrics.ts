/**
 * Fetching lyrics, once per track.
 *
 * Nothing here joins the 3-5s player poll, and nothing is fetched while the
 * lyrics view is closed -- the same rule useLibrary follows for playlists, and
 * here it is also a privacy rule: the title and artist leave the machine only
 * while you are looking at the lyrics.
 *
 * Results are cached for the session, including misses. A track with no
 * lyrics would otherwise be asked about again every time you came back to it.
 */

import { useEffect, useRef, useState } from 'react'
import type { Lyrics, TrackSummary } from '../../core/contract.js'
import type { Load } from '../useLibrary.js'

/** `null` inside a ready result means the track simply has none. */
export type LyricsLoad = Load<Lyrics | null>

const IDLE: LyricsLoad = { status: 'idle' }

export function useLyrics({
  enabled,
  track,
}: {
  /** False while the lyrics view is off. No view, no request. */
  enabled: boolean
  track: TrackSummary | null
}): LyricsLoad {
  const [load, setLoad] = useState<LyricsLoad>(IDLE)
  const cache = useRef(new Map<string, Lyrics | null>())

  const trackId = track?.trackId ?? null

  useEffect(() => {
    if (!enabled || !track || !trackId) {
      setLoad(IDLE)
      return
    }

    const cached = cache.current
    if (cached.has(trackId)) {
      setLoad({ status: 'ready', value: cached.get(trackId) ?? null })
      return
    }

    let cancelled = false
    setLoad({ status: 'loading' })

    void (async () => {
      const result = await window.vuelta.getLyrics({
        title: track.title,
        artist: track.artist,
        album: track.album,
        durationMs: track.durationMs,
      })
      // The song can change while a lookup is in flight, and a late answer
      // about the previous track would otherwise land on this one.
      if (cancelled) return

      if (!result.ok) {
        setLoad({ status: 'error', message: result.message })
        return
      }
      cached.set(trackId, result.lyrics)
      setLoad({ status: 'ready', value: result.lyrics })
    })()

    return () => {
      cancelled = true
    }
    // `track` sits in here alongside its own id, which is only safe because
    // useSync replaces that object when the id changes and not on every poll
    // (useSync.ts, `if (id !== lastTrackId)`). Were it rebuilt each time, this
    // would re-ask for the same lyrics four times a second.
  }, [enabled, trackId, track])

  return load
}
