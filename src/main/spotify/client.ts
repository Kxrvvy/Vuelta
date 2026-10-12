/**
 * The one and only module that knows Spotify exists.
 *
 * CLAUDE.md: "Keep every Spotify API call behind one module. Spotify changes
 * their terms often; a migration should touch one file." That includes the
 * authorize URL, the token endpoint, and the shape of their JSON — none of
 * which appear anywhere else in the codebase.
 *
 * Uses Node's global `fetch`. No HTTP dependency.
 */

import type {
  CommandResult,
  VueltaErrorCode,
  PlaybackSnapshot,
  PlayerPoll,
  PlaylistsResult,
  PlaylistSummary,
  PlaylistTrack,
  PlaylistTracksResult,
  QueueResult,
  TrackSummary,
} from '../../core/contract.js'
import { SPOTIFY_SCOPES } from '../../core/contract.js'
import { writeConfig } from '../config.js'
import { VueltaError, toVueltaError } from '../errors.js'
import { clearSession, loadRefreshToken, saveRefreshToken } from '../tokens.js'

const ACCOUNTS_BASE = 'https://accounts.spotify.com'
const API_BASE = 'https://api.spotify.com/v1'

/** Access tokens live in memory only, and only in the main process. */
let accessToken: string | null = null
let accessTokenExpiresAt = 0

/** Refresh this many ms before nominal expiry, so a request never races the clock. */
const EXPIRY_MARGIN_MS = 30_000

export function forgetAccessToken(): void {
  accessToken = null
  accessTokenExpiresAt = 0
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

export function buildAuthorizeUrl(options: {
  clientId: string
  redirectUri: string
  challenge: string
  state: string
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    state: options.state,
    scope: SPOTIFY_SCOPES.join(' '),
    code_challenge_method: 'S256',
    code_challenge: options.challenge,
  })
  return `${ACCOUNTS_BASE}/authorize?${params.toString()}`
}

type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in: number
  /** Space-separated. What was actually granted, which can differ from the ask. */
  scope?: string
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  let response: Response
  try {
    response = await fetch(`${ACCOUNTS_BASE}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
  } catch (cause) {
    throw toVueltaError(cause)
  }

  const text = await response.text()
  if (!response.ok) {
    // Spotify's token errors are {"error":"...","error_description":"..."}.
    let description = text
    let error = ''
    try {
      const parsed = JSON.parse(text) as { error?: string; error_description?: string }
      error = parsed.error ?? ''
      description = parsed.error_description ?? text
    } catch {
      /* keep the raw body */
    }

    if (error === 'invalid_grant') {
      // The refresh token was revoked or belongs to a different app. It will
      // never work again, so drop it rather than retrying forever.
      clearSession()
      throw new VueltaError('auth-failed', 'Your Spotify session expired. Please connect again.')
    }
    if (error === 'invalid_client') {
      throw new VueltaError(
        'auth-failed',
        'Spotify rejected the Client ID. Check that it was copied correctly and that the redirect URI is registered exactly.',
      )
    }
    throw new VueltaError('auth-failed', description || `Token request failed (${response.status}).`)
  }

  return JSON.parse(text) as TokenResponse
}

function storeTokens(tokens: TokenResponse): void {
  accessToken = tokens.access_token
  accessTokenExpiresAt = Date.now() + tokens.expires_in * 1000
  // Spotify may rotate the refresh token on any refresh. Persisting the new
  // one is what keeps "never log in again" true.
  if (tokens.refresh_token) saveRefreshToken(tokens.refresh_token)
  // Record what was granted rather than what was asked for. A refresh never
  // widens scope, so this is how a session issued before a scope was added
  // stays distinguishable from a current one.
  if (typeof tokens.scope === 'string') {
    writeConfig({ grantedScopes: tokens.scope.split(' ').filter((part) => part.length > 0) })
  }
}

export async function exchangeCodeForTokens(options: {
  clientId: string
  code: string
  verifier: string
  redirectUri: string
}): Promise<void> {
  storeTokens(
    await postToken(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: options.code,
        redirect_uri: options.redirectUri,
        client_id: options.clientId,
        code_verifier: options.verifier,
      }),
    ),
  )
}

async function refreshAccessToken(clientId: string): Promise<void> {
  const refreshToken = loadRefreshToken()
  if (!refreshToken) {
    throw new VueltaError('auth-failed', 'No stored Spotify session. Please connect again.')
  }
  storeTokens(
    await postToken(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      }),
    ),
  )
}

async function ensureAccessToken(clientId: string): Promise<string> {
  if (accessToken && Date.now() < accessTokenExpiresAt - EXPIRY_MARGIN_MS) return accessToken
  await refreshAccessToken(clientId)
  if (!accessToken) throw new VueltaError('auth-failed', 'Could not obtain a Spotify access token.')
  return accessToken
}

// ---------------------------------------------------------------------------
// API requests
// ---------------------------------------------------------------------------

/**
 * Returns parsed JSON, or `null` for HTTP 204.
 *
 * 204 with an empty body is not an error — it is the NO_DEVICE state, and on
 * `GET /me/player` it is the single most common response this app will ever
 * see. Treating it as a failure would light up an error screen constantly.
 */
async function request<T>(clientId: string, path: string, init?: RequestInit): Promise<T | null> {
  const send = async (token: string): Promise<Response> => {
    try {
      return await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
      })
    } catch (cause) {
      throw toVueltaError(cause)
    }
  }

  let response = await send(await ensureAccessToken(clientId))

  if (response.status === 401) {
    // The token died earlier than advertised. Refresh once and retry.
    forgetAccessToken()
    response = await send(await ensureAccessToken(clientId))
  }

  if (response.status === 204) return null

  if (response.status === 429) {
    const header = Number(response.headers.get('retry-after') ?? '1')
    const seconds = Number.isFinite(header) && header > 0 ? header : 1
    throw new VueltaError(
      'rate-limited',
      `Spotify asked us to slow down. Retrying is safe in ${seconds}s.`,
      seconds * 1000,
    )
  }

  if (response.status === 404) {
    // NO_ACTIVE_DEVICE. On a control call this is not a bug — Spotify simply
    // is not running, which is the same situation GET /me/player reports as
    // a 204. Same designed screen, different status code.
    throw new VueltaError(
      'no-device',
      'No active Spotify device. Open Spotify and press play once, then try again.',
    )
  }

  if (response.status === 403) {
    const body = await response.text()
    if (/premium/i.test(body)) {
      throw new VueltaError('premium-required', 'Controlling playback requires Spotify Premium.')
    }
    // Spec §3: the most common support issue by far. Never show this raw.
    throw new VueltaError(
      'not-allowlisted',
      'Spotify refused the request. Your account is probably not on your own app’s user list yet.',
    )
  }

  if (!response.ok) {
    throw new VueltaError('unknown', `Spotify returned HTTP ${response.status}.`)
  }

  const text = await response.text()
  if (text.length === 0) return null
  return JSON.parse(text) as T
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

type SpotifyImage = { url: string; width: number | null; height: number | null }

type SpotifyPlayerResponse = {
  progress_ms: number | null
  is_playing: boolean
  device: { name: string; volume_percent: number | null } | null
  context: { uri: string } | null
  item: {
    id: string | null
    name: string
    duration_ms: number
    artists: { name: string }[]
    album: { name: string; images: SpotifyImage[] }
  } | null
}

/** Spotify returns images widest-first; the first entry is the highest resolution. */
function largestImage(images: SpotifyImage[]): string | null {
  return images[0]?.url ?? null
}

function toTrackSummary(item: NonNullable<SpotifyPlayerResponse['item']>): TrackSummary {
  return {
    trackId: item.id ?? '',
    title: item.name,
    artist: item.artists.map((a) => a.name).join(', '),
    album: item.album.name,
    albumArtUrl: largestImage(item.album.images),
    durationMs: item.duration_ms,
  }
}

export async function getPlayer(clientId: string): Promise<PlayerPoll> {
  try {
    const data = await request<SpotifyPlayerResponse>(clientId, '/me/player')
    if (data === null) return { kind: 'no-device' }

    const snapshot: PlaybackSnapshot = {
      track: data.item ? toTrackSummary(data.item) : null,
      isPlaying: data.is_playing,
      progressMs: data.progress_ms ?? 0,
      volumePercent: data.device?.volume_percent ?? null,
      deviceName: data.device?.name ?? null,
      contextUri: data.context?.uri ?? null,
      fetchedAt: Date.now(),
    }
    return { kind: 'ok', snapshot }
  } catch (cause) {
    const error = toVueltaError(cause)
    return { kind: 'error', code: error.code, message: error.message }
  }
}

// ---------------------------------------------------------------------------
// Playback control
//
// Every one of these is a round trip to Spotify's servers, which then relay to
// the desktop client. Vuelta plays no audio; it is a remote control.
//
// These endpoints answer 204 with an empty body on success, which `request`
// already returns as null. A 404 means no active device, and a 403 means
// either no Premium or a Client ID the user has not allowlisted — all three
// are mapped to codes the renderer turns into designed screens.
// ---------------------------------------------------------------------------

async function command(
  clientId: string,
  method: 'PUT' | 'POST',
  path: string,
): Promise<CommandResult> {
  try {
    await request(clientId, path, { method })
    return { ok: true }
  } catch (cause) {
    const error = toVueltaError(cause)
    return error.retryAfterMs === undefined
      ? { ok: false, code: error.code, message: error.message }
      : { ok: false, code: error.code, message: error.message, retryAfterMs: error.retryAfterMs }
  }
}

/** No body: Spotify resumes the user's last context, which is how playback
 *  starts without Vuelta needing a library browser (spec §7). */
export function play(clientId: string): Promise<CommandResult> {
  return command(clientId, 'PUT', '/me/player/play')
}

export function pause(clientId: string): Promise<CommandResult> {
  return command(clientId, 'PUT', '/me/player/pause')
}

export function seek(clientId: string, positionMs: number): Promise<CommandResult> {
  const position = Math.max(0, Math.round(positionMs))
  return command(clientId, 'PUT', `/me/player/seek?position_ms=${position}`)
}

export function next(clientId: string): Promise<CommandResult> {
  return command(clientId, 'POST', '/me/player/next')
}

export function previous(clientId: string): Promise<CommandResult> {
  return command(clientId, 'POST', '/me/player/previous')
}

export function setVolume(clientId: string, percent: number): Promise<CommandResult> {
  const volume = Math.max(0, Math.min(100, Math.round(percent)))
  return command(clientId, 'PUT', `/me/player/volume?volume_percent=${volume}`)
}

// ---------------------------------------------------------------------------
// Playlists and the queue
//
// Reads here are user-triggered, not polled. The browser bar fetches on open
// and caches; nothing below joins the 3-5s player poll.
// ---------------------------------------------------------------------------

type SpotifyPlaylistItem = {
  id: string
  uri: string
  name: string
  images: SpotifyImage[] | null
  tracks: { total: number } | null
}

/** Spotify's own playlist pages can contain nulls. This is not defensive padding. */
type SpotifyPlaylistsResponse = { items: (SpotifyPlaylistItem | null)[] | null }

type SpotifyTrackItem = {
  uri: string
  id: string | null
  name: string
  duration_ms: number | null
  artists: { name: string }[] | null
}

type SpotifyPlaylistTracksResponse = {
  items: ({ track: SpotifyTrackItem | null } | null)[] | null
}

type SpotifyQueueResponse = {
  currently_playing: SpotifyTrackItem | null
  queue: (SpotifyTrackItem | null)[] | null
}

function toPlaylistTrack(item: SpotifyTrackItem): PlaylistTrack {
  return {
    uri: item.uri,
    trackId: item.id ?? '',
    title: item.name,
    // Episodes come back through these same endpoints and carry no artists.
    artist: (item.artists ?? []).map((a) => a.name).join(', '),
    durationMs: item.duration_ms ?? 0,
  }
}

/**
 * Re-label a 403 on a playlist read.
 *
 * `request` maps every 403 to `not-allowlisted`, whose message sends the user
 * to the developer dashboard. That is right for a playback call and wrong here:
 * on a playlist read the overwhelmingly likely cause is a session granted
 * before the playlist scopes were asked for, and the fix is a reconnect. The
 * stale-scope check should catch this first; this is the backstop for when it
 * does not.
 */
function asLibraryFailure(cause: unknown): { code: VueltaErrorCode; message: string } {
  const error = toVueltaError(cause)
  if (error.code === 'not-allowlisted') {
    return {
      code: 'scope-missing',
      message:
        'Spotify would not share your playlists with this session. Reconnect to grant playlist access.',
    }
  }
  return { code: error.code, message: error.message }
}

export async function getPlaylists(clientId: string): Promise<PlaylistsResult> {
  try {
    const data = await request<SpotifyPlaylistsResponse>(clientId, '/me/playlists?limit=50')
    const playlists: PlaylistSummary[] = (data?.items ?? [])
      .filter((item): item is SpotifyPlaylistItem => item !== null)
      .map((item) => ({
        playlistId: item.id,
        uri: item.uri,
        name: item.name,
        trackCount: item.tracks?.total ?? 0,
        coverUrl: largestImage(item.images ?? []),
      }))
    return { ok: true, playlists }
  } catch (cause) {
    return { ok: false, ...asLibraryFailure(cause) }
  }
}

export async function getPlaylistTracks(
  clientId: string,
  playlistId: string,
): Promise<PlaylistTracksResult> {
  // `fields` is not an optimisation. Without it a 100-track page arrives with a
  // full album object per track, which is megabytes for a list of names.
  const fields = 'items(track(uri,id,name,duration_ms,artists(name)))'
  try {
    const data = await request<SpotifyPlaylistTracksResponse>(
      clientId,
      `/playlists/${encodeURIComponent(playlistId)}/tracks?limit=100&fields=${encodeURIComponent(fields)}`,
    )
    const tracks = (data?.items ?? [])
      .map((row) => row?.track ?? null)
      .filter((track): track is SpotifyTrackItem => track !== null)
      .map(toPlaylistTrack)
    return { ok: true, tracks }
  } catch (cause) {
    return { ok: false, ...asLibraryFailure(cause) }
  }
}

export async function getQueue(clientId: string): Promise<QueueResult> {
  try {
    const data = await request<SpotifyQueueResponse>(clientId, '/me/player/queue')
    // 204, same as the player: no active device rather than a failure.
    if (data === null) {
      return { ok: true, queue: { currentUri: null, items: [] } }
    }
    return {
      ok: true,
      queue: {
        currentUri: data.currently_playing?.uri ?? null,
        items: (data.queue ?? [])
          .filter((item): item is SpotifyTrackItem => item !== null)
          .map(toPlaylistTrack),
      },
    }
  } catch (cause) {
    const error = toVueltaError(cause)
    return { ok: false, code: error.code, message: error.message }
  }
}

/**
 * Start a context, optionally at one track inside it.
 *
 * Deliberately not routed through `command`: every other caller of that
 * depends on sending no body at all, because a bodiless play is what resumes
 * the user's last context (spec section 7). Widening it would put a body on
 * the disc click.
 */
export async function playContext(
  clientId: string,
  contextUri: string,
  offsetUri?: string,
): Promise<CommandResult> {
  const body: { context_uri: string; offset?: { uri: string } } = { context_uri: contextUri }
  if (offsetUri) body.offset = { uri: offsetUri }

  try {
    await request(clientId, '/me/player/play', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { ok: true }
  } catch (cause) {
    const error = toVueltaError(cause)
    return error.retryAfterMs === undefined
      ? { ok: false, code: error.code, message: error.message }
      : { ok: false, code: error.code, message: error.message, retryAfterMs: error.retryAfterMs }
  }
}

export function addToQueue(clientId: string, trackUri: string): Promise<CommandResult> {
  return command(clientId, 'POST', `/me/player/queue?uri=${encodeURIComponent(trackUri)}`)
}
