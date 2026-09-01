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

import type { PlaybackSnapshot, PlayerPoll, TrackSummary } from '../../core/contract.js'
import { SPOTIFY_SCOPES } from '../../core/contract.js'
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
    const retryAfter = Number(response.headers.get('retry-after') ?? '1')
    throw new VueltaError(
      'rate-limited',
      `Spotify asked us to slow down. Retrying is safe in ${Number.isFinite(retryAfter) ? retryAfter : 1}s.`,
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
      fetchedAt: Date.now(),
    }
    return { kind: 'ok', snapshot }
  } catch (cause) {
    const error = toVueltaError(cause)
    return { kind: 'error', code: error.code, message: error.message }
  }
}
