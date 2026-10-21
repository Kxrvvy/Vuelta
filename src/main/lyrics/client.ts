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
/**
 * The fuzzy one, for when the exact lookup finds nothing.
 *
 * `/api/get` matches on duration, and it matches it tightly: Spotify's figure
 * and LRCLIB's routinely differ by a second or two for the same recording, and
 * that is enough to come back empty. Measured against three tracks the app was
 * calling lyric-less, `/api/search` had 1, 6 and 5 synced results for them.
 */
const SEARCH_ENDPOINT = 'https://lrclib.net/api/search'

/** How far apart two durations can be and still be the same recording. */
const DURATION_TOLERANCE_S = 8

/** Long enough for a cold lookup, short enough not to hang the pane. */
const TIMEOUT_MS = 6000

type LrclibResponse = {
  syncedLyrics?: string | null
  plainLyrics?: string | null
  instrumental?: boolean
  duration?: number
}

/** LRCLIB's error shape, which is what separates a miss from an outage. */
type LrclibError = { name?: string; statusCode?: number }

const HEADERS = {
  Accept: 'application/json',
  'User-Agent': '',
}

/**
 * Is this non-200 the service being unwell, rather than an honest "no such
 * track"?
 *
 * It has to be read off the body, not the status. An unmatched lookup was once
 * observed coming back 503, which is why everything non-200 used to count as a
 * miss -- but a real overload says so in the body (`ServerOverloaded`), and the
 * difference matters: a miss is cached for the session, so one bad minute from
 * the service would otherwise mark a track lyric-less until the app restarts.
 */
async function isOutage(response: Response): Promise<boolean> {
  if (response.status === 429) return true
  if (response.status < 500) return false
  try {
    const body = (await response.json()) as LrclibError
    return body?.name === 'ServerOverloaded'
  } catch {
    // A 5xx with no JSON to explain itself is still the server's problem.
    return true
  }
}

/**
 * The fuzzy lookup, ranked ourselves: closest duration first, and synced over
 * plain where both are close. LRCLIB returns the best text match, which for a
 * common title is not necessarily the recording being played.
 */
function pickBest(results: LrclibResponse[], durationMs: number): LrclibResponse | null {
  const wanted = durationMs / 1000
  const scored = results
    .map((entry) => ({
      entry,
      off: typeof entry.duration === 'number' ? Math.abs(entry.duration - wanted) : Infinity,
      synced: (entry.syncedLyrics ?? '').length > 0,
    }))
    .filter((row) => row.off <= DURATION_TOLERANCE_S)
    .sort((a, b) => (a.synced === b.synced ? a.off - b.off : a.synced ? -1 : 1))
  return scored[0]?.entry ?? null
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

  const headers = {
    ...HEADERS,
    'User-Agent': `Vuelta/${app.getVersion()} (https://github.com/Kxrvvy/Vuelta)`,
  }

  try {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    let data: LrclibResponse | null = null

    if (response.ok) {
      data = (await response.json()) as LrclibResponse
    } else if (await isOutage(response)) {
      // Not a miss, and above all not one to remember: the caller caches a
      // miss for the session, which would leave this track blank until the
      // app restarts over a minute of the service being busy.
      return {
        ok: false,
        code: 'network',
        message: 'The lyrics service is busy. It will try again.',
      }
    } else {
      // An honest miss from the exact lookup, which is mostly a duration that
      // does not agree rather than a track nobody has transcribed. Ask again
      // without it before giving up.
      const found = await fetch(
        `${SEARCH_ENDPOINT}?${new URLSearchParams({
          track_name: query.title,
          artist_name: query.artist,
        }).toString()}`,
        { headers, signal: AbortSignal.timeout(TIMEOUT_MS) },
      )
      if (found.ok) {
        const results = (await found.json()) as LrclibResponse[]
        data = Array.isArray(results) ? pickBest(results, query.durationMs) : null
      } else if (await isOutage(found)) {
        // The same trap one level down, and the one that matters more: by the
        // time the fallback runs, the exact lookup has already missed, so a
        // busy search is the difference between "no lyrics" and the lyrics.
        // Observed: a track with two synced results came back blank because
        // this branch quietly fell through to a miss -- and a miss is cached.
        return {
          ok: false,
          code: 'network',
          message: 'The lyrics service is busy. It will try again.',
        }
      }
    }

    if (!data) return { ok: true, lyrics: null }
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
