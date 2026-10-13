/**
 * Lyrics, from LRCLIB.
 *
 * Deliberately not inside spotify/client.ts. Spotify has no lyrics endpoint at
 * all -- the lyrics in the Spotify client come from an internal service that
 * is not part of the Web API -- so this is a different service with different
 * failure modes, and that module's `request()` maps every 403 to
 * `not-allowlisted`, which would be nonsense here.
 *
 * LRCLIB (https://lrclib.net) is free, open and needs no key. It asks callers
 * to identify themselves in the User-Agent, which is the only reason this file
 * knows the app version.
 *
 * What leaves the machine: the track title, artist, album and duration, and
 * only while the lyrics view is open. SECURITY.md says so too.
 */

import { app } from 'electron'
import type { LyricsResult } from '../../core/contract.js'
import { parseLrc } from '../../core/lyrics.js'

const ENDPOINT = 'https://lrclib.net/api/get'

/** Long enough for a cold lookup, short enough not to hang the pane. */
const TIMEOUT_MS = 6000

type LrclibResponse = {
  syncedLyrics?: string | null
  plainLyrics?: string | null
  instrumental?: boolean
}

export type LyricsQuery = {
  title: string
  artist: string
  album: string
  durationMs: number
}

export async function fetchLyrics(query: LyricsQuery): Promise<LyricsResult> {
  const url = new URL(ENDPOINT)
  url.searchParams.set('track_name', query.title)
  url.searchParams.set('artist_name', query.artist)
  if (query.album) url.searchParams.set('album_name', query.album)
  // Seconds, and used for matching: it is what separates a single edit from
  // the album cut when both share a title.
  url.searchParams.set('duration', String(Math.round(query.durationMs / 1000)))

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': `Vuelta/${app.getVersion()} (https://github.com/Kxrvvy/Vuelta)`,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    // Every non-200 is "nothing known about this track", never an error on
    // screen. The documented miss is a 404, but an unmatched lookup was
    // observed coming back 503, so switching on the exact status would turn a
    // routine miss into a failure message for whole classes of track.
    if (!response.ok) return { ok: true, lyrics: null }

    const data = (await response.json()) as LrclibResponse
    const synced = data.syncedLyrics ?? ''
    const plain = data.plainLyrics?.trim() ?? ''

    return {
      ok: true,
      lyrics: {
        lines: parseLrc(synced),
        // Kept only when there is nothing synced to show instead.
        plain: plain.length > 0 ? plain : null,
        instrumental: data.instrumental === true,
      },
    }
  } catch {
    // A real failure: offline, DNS, or the timeout above. Distinct from a miss
    // because this one is worth telling the user about.
    return { ok: false, code: 'network', message: 'Could not reach the lyrics service.' }
  }
}
