/**
 * The contract between layers.
 *
 * This file is the widest-reach module in the project: `main/` reads it to
 * shape what it sends over IPC, and `app/` (later `skins/`) reads it to know
 * what it may draw. It contains types and constants only — no behaviour — so
 * importing it can never drag a dependency across a boundary.
 *
 * Layer rule: core/ has no DOM and no Node globals. See tsconfig.core.json.
 */

// Type-only, and therefore erased: this file still carries no behaviour and
// importing it still drags nothing across a boundary.
import type { LyricLine } from './lyrics.js'
import type { TransitionPhase } from './transition.js'

// ---------------------------------------------------------------------------
// Render contract — spec §6
// ---------------------------------------------------------------------------

/**
 * Everything a skin is allowed to know. A skin receives this and `Actions`,
 * and nothing else: no tokens, no fetch, no awareness that Spotify exists.
 * That is what makes a future photoreal renderer a swap rather than a rewrite.
 *
 * M0 populates only `progressMs`, `durationMs`, `isPlaying` and `albumArtUrl`.
 * The rest are declared now, with documented defaults in `INITIAL_RENDER_STATE`,
 * so that M1–M6 fill them in rather than renegotiate the shape.
 */
export type RenderState = {
  progressMs: number
  durationMs: number
  isPlaying: boolean
  albumArtUrl: string | null
  /** Pre-fetched from the queue so a record swap can start before the boundary (M6). */
  nextAlbumArtUrl: string | null
  /** Degrees. Owned by core; skins write it to `transform` via a ref, never through React state. */
  armAngle: number
  /** While true, the clock and the reconciler both stand down (M3). */
  isDragging: boolean
  lidOpen: boolean
  /** Drives spin-up / spin-down easing; never an instant stop (M2). */
  platterRpm: number
  transitionPhase: TransitionPhase
  /**
   * How far the record is out of its sleeve: 0 completely hidden behind it,
   * 1 fully out. Only the flat-lay draws it, but it belongs here rather than
   * in that skin because `core/transition.ts` owns the shape of the move.
   */
  transitionOut: number
}

/**
 * Which of the three looks the machine is wearing.
 *
 * Not a RenderState field. RenderState is read from a ref sixty times a second
 * and never through React; the view is the opposite kind of value -- it mounts
 * a column and moves cameras, so it has to be a prop React can see. The field
 * that used to sit here, `view: 'top' | 'console'`, was never read by anything
 * and meant something else entirely, so it is gone rather than overloaded.
 */
export type VueltaView = 'main' | 'lyrics' | 'closeup'

/** In switch order, which is also the order of the 1/2/3 keys. */
export const VIEWS: readonly { id: VueltaView; label: string }[] = [
  { id: 'main', label: 'Main' },
  { id: 'lyrics', label: 'Lyrics' },
  { id: 'closeup', label: 'Close-up' },
]

/** The only way a skin can affect the world. Every one of these is fire-and-forget. */
export type Actions = {
  play(): void
  pause(): void
  seek(ms: number): void
  next(): void
  previous(): void
  setVolume(percent: number): void
}

// ---------------------------------------------------------------------------
// Tonearm geometry — spec §10
// ---------------------------------------------------------------------------

/**
 * One source of truth for the arm sweep. Spec §17 asks that the static mockup
 * and the code use the same numbers; these are those numbers.
 */
export const ARM = {
  /** In the cradle, off the record. */
  REST_ANGLE: -12,
  /** Outer groove, position 0. */
  START_ANGLE: 0,
  /** Inner groove, track end. */
  END_ANGLE: 22,
} as const

// ---------------------------------------------------------------------------
// Platter speed
// ---------------------------------------------------------------------------

/** 33⅓ rpm — the true speed of a 12" LP. Kept as the physical reference. */
export const LP_RPM = 100 / 3

/**
 * What Vuelta actually turns the disc at: half of life, 16⅔ rpm, one
 * revolution every 3.6s.
 *
 * A deliberate deviation, and the only one in the geometry. At the true 33⅓ a
 * revolution takes 1.8s, which is accurate and reads as hurried — the album art
 * on the label becomes a flicker rather than something you watch. Halving it
 * keeps the motion unmistakably a spinning record while letting it sit still
 * enough to look at.
 *
 * This is the one authority for the rate. `platterRpm` is a RenderState field,
 * so the number belongs to the contract rather than to either the state layer
 * or the skin — both of which used to carry their own copy.
 */
export const PLATTER_RPM = LP_RPM / 2

export const INITIAL_RENDER_STATE: RenderState = {
  progressMs: 0,
  durationMs: 0,
  isPlaying: false,
  albumArtUrl: null,
  nextAlbumArtUrl: null,
  armAngle: ARM.REST_ANGLE,
  isDragging: false,
  lidOpen: false,
  platterRpm: 0,
  transitionPhase: 'idle',
  transitionOut: 1,
}

// ---------------------------------------------------------------------------
// Playback data — what main/ is allowed to hand the renderer
// ---------------------------------------------------------------------------

/**
 * A deliberately narrow projection of Spotify's player payload. Main maps the
 * raw response into this and sends nothing else, so no access token, refresh
 * token, or raw API body can leak into the renderer by accident.
 */
export type TrackSummary = {
  trackId: string
  title: string
  /** Already joined for display — skins do no formatting. */
  artist: string
  album: string
  albumArtUrl: string | null
  durationMs: number
}

export type PlaybackSnapshot = {
  track: TrackSummary | null
  isPlaying: boolean
  progressMs: number
  volumePercent: number | null
  deviceName: string | null
  /**
   * The playlist or album playback is running from, as a Spotify URI.
   *
   * Carried because it is what makes a queue jump a single call: `play` with a
   * context plus a track offset lands directly on a track, where otherwise the
   * only route would be firing `next` repeatedly. It also lets the playlist
   * pane mark the one that is currently playing.
   */
  contextUri: string | null
  /**
   * Wall-clock ms at which this snapshot was received. M1's reconciler needs
   * it to know how stale the reading is before easing toward it.
   */
  fetchedAt: number
}

// ---------------------------------------------------------------------------
// Playlists and the queue
//
// Narrow projections again, for the same reason as TrackSummary: the raw
// playlist and queue payloads are large, deeply nested, and full of fields the
// renderer has no business seeing.
// ---------------------------------------------------------------------------

export type PlaylistSummary = {
  playlistId: string
  /** Context URI. This is the handle that starts playback. */
  uri: string
  name: string
  trackCount: number
  coverUrl: string | null
}

export type PlaylistTrack = {
  /** Track URI — the play offset, and what gets added to the queue. */
  uri: string
  trackId: string
  title: string
  /** Already joined for display; the renderer does no formatting. */
  artist: string
  durationMs: number
  /**
   * Cover art, which M6's record swap needs: the next record's sleeve has to
   * be on screen before the boundary, and the queue is where the next record
   * comes from.
   */
  albumArtUrl: string | null
}

export type QueueSnapshot = {
  /** URI of what is playing now, so the pane can mark its own first row. */
  currentUri: string | null
  /** Upcoming items in order. Spotify returns roughly twenty. */
  items: PlaylistTrack[]
}

export type PlaylistsResult =
  | { ok: true; playlists: PlaylistSummary[] }
  | { ok: false; code: VueltaErrorCode; message: string }

export type PlaylistTracksResult =
  | { ok: true; tracks: PlaylistTrack[] }
  | { ok: false; code: VueltaErrorCode; message: string }

/**
 * What is known about one track's lyrics.
 *
 * `lines` is empty when nothing synced was found, which is also the case for
 * an instrumental; `plain` then carries the unsynced sheet if there is one, so
 * the column can show something that does not follow the song rather than
 * nothing at all.
 */
export type Lyrics = {
  lines: LyricLine[]
  plain: string | null
  instrumental: boolean
}

/**
 * `lyrics: null` is a miss, and a miss is not a failure -- plenty of tracks
 * simply have none. `ok: false` is reserved for not being able to ask.
 */
export type LyricsResult =
  | { ok: true; lyrics: Lyrics | null }
  | { ok: false; code: VueltaErrorCode; message: string }

/** What main needs to find them. Nothing identifying the user. */
export type LyricsQuery = {
  title: string
  artist: string
  album: string
  durationMs: number
}

export type QueueResult =
  | { ok: true; queue: QueueSnapshot }
  | { ok: false; code: VueltaErrorCode; message: string }

/**
 * `GET /me/player` returning 204 with an empty body is not an error — it is
 * the NO_DEVICE state, and it happens constantly. Modelling it as a variant
 * rather than a thrown error is what keeps that from being handled as a crash.
 */
export type PlayerPoll =
  | { kind: 'ok'; snapshot: PlaybackSnapshot }
  | { kind: 'no-device' }
  | { kind: 'error'; code: VueltaErrorCode; message: string; retryAfterMs?: number }

/**
 * The result of a playback command.
 *
 * A result rather than a thrown error, for the same reason `saveClientId`
 * returns one: an exception crossing IPC reaches the renderer as "Error
 * invoking remote method …", which is exactly the raw-error experience
 * spec §3 warns against.
 */
/**
 * What came of trying to open Spotify and start it.
 *
 * Every failure here ends in silence if it is not named: the URI goes nowhere
 * when Spotify is not installed, a signed-out client never registers as a
 * device, and an account with nothing to resume transfers happily and then
 * plays no music. So the renderer gets the cause, not just a boolean.
 */
export type LaunchSpotifyResult =
  /**
   * Spotify is up and is now the active device, but deliberately not playing
   * yet: the machine opens its lid first and the renderer sends play after.
   */
  | { kind: 'armed' }
  /** A device was already there, so nothing was launched. */
  | { kind: 'device-already' }
  /** The `spotify:` link went nowhere. */
  | { kind: 'not-installed' }
  /** Launched, but no device ever registered. Signed out, or just slow. */
  | { kind: 'never-appeared' }
  /** Connected, but the account had no playback to continue. */
  | { kind: 'nothing-to-resume' }
  /** Spotify answered, and said no. */
  | { kind: 'failed'; message: string }

export type CommandResult =
  | { ok: true }
  | { ok: false; code: VueltaErrorCode; message: string; retryAfterMs?: number }

// ---------------------------------------------------------------------------
// Errors and setup
// ---------------------------------------------------------------------------

export type VueltaErrorCode =
  /** HTTP 403 — the user has not allowlisted themselves on their own Spotify app. */
  | 'not-allowlisted'
  /**
   * HTTP 403 on a playlist read, where the likely cause is a session granted
   * before the playlist scopes were asked for. A separate code because the
   * fix is a reconnect, not a trip to the developer dashboard.
   */
  | 'scope-missing'
  /** Playback control requires Premium. */
  | 'premium-required'
  /** HTTP 404 NO_ACTIVE_DEVICE on a control call. Spotify isn't running. */
  | 'no-device'
  | 'no-client-id'
  | 'auth-failed'
  | 'auth-cancelled'
  | 'port-unavailable'
  | 'network'
  | 'rate-limited'
  | 'secure-storage-unavailable'
  | 'unknown'

export type SetupInfo = {
  clientId: string | null
  /** The exact string the user must paste into their Spotify dashboard. */
  redirectUri: string
  redirectPort: number
  /** True when 8888 was taken and a fallback was chosen — the user must add it too. */
  portIsFallback: boolean
  /** A refresh token is on disk, so launch can skip straight to connecting. */
  hasStoredSession: boolean
  /**
   * True when there is a stored session that was granted fewer scopes than
   * Vuelta now asks for.
   *
   * Refreshing a token never widens its scope, so a session from before the
   * playlist scopes existed can poll the player perfectly well and will fail
   * every playlist read with a 403. Detecting it here is what lets the UI ask
   * for one reconnect instead of showing an error that looks like a bug.
   */
  scopesStale: boolean
  /** False means we refuse to persist a token rather than write one in plaintext. */
  secureStorageAvailable: boolean
}

export type AuthOutcome = { ok: true } | { ok: false; code: VueltaErrorCode; message: string }

/**
 * Explicit success/failure rather than a thrown error, because an exception
 * crossing IPC arrives in the renderer as "Error invoking remote method …",
 * which is exactly the raw-error experience spec §3 warns against.
 */
export type SaveClientIdResult =
  | { ok: true; setup: SetupInfo }
  | { ok: false; message: string }

// ---------------------------------------------------------------------------
// The preload bridge
// ---------------------------------------------------------------------------

/**
 * The complete surface exposed to the renderer as `window.vuelta`. If it is
 * not on this type, the renderer cannot reach it.
 */
export type VueltaBridge = {
  getSetup(): Promise<SetupInfo>
  saveClientId(clientId: string): Promise<SaveClientIdResult>
  startAuth(): Promise<AuthOutcome>
  signOut(): Promise<void>
  getPlayer(): Promise<PlayerPoll>
  /**
   * Goes through Electron's clipboard rather than `navigator.clipboard`, which
   * needs a secure context the packaged app's `file://` origin does not provide.
   */
  copyText(text: string): Promise<void>

  // --- playback control ---------------------------------------------------
  // Mirrors `Actions`, but async and fallible, because each one is a network
  // round trip through Spotify's servers to the desktop client.
  launchSpotify(): Promise<LaunchSpotifyResult>
  play(): Promise<CommandResult>
  pause(): Promise<CommandResult>
  /** Commits on drag release only, never during the drag. */
  seek(positionMs: number): Promise<CommandResult>
  next(): Promise<CommandResult>
  previous(): Promise<CommandResult>
  /** Throttled by the caller to roughly one call per 400ms. */
  setVolume(percent: number): Promise<CommandResult>

  // --- playlists and the queue --------------------------------------------
  // Reads are user-triggered and cached by the caller; none of these joins the
  // 3-5s player poll.
  getPlaylists(): Promise<PlaylistsResult>
  getPlaylistTracks(playlistId: string): Promise<PlaylistTracksResult>
  getQueue(): Promise<QueueResult>
  /** Starts a context, optionally at one track within it. */
  playContext(contextUri: string, offsetUri?: string): Promise<CommandResult>
  addToQueue(trackUri: string): Promise<CommandResult>

  // --- lyrics ---------------------------------------------------------------
  // Not Spotify: Spotify's Web API has no lyrics endpoint. This one goes to
  // LRCLIB, and only while the lyrics view is open.
  getLyrics(query: LyricsQuery): Promise<LyricsResult>
}

/** Spotify Client IDs are 32 hex characters. Shared so both sides validate identically. */
export const CLIENT_ID_PATTERN = /^[0-9a-f]{32}$/i

/**
 * Every scope Vuelta asks for, and nothing beyond. Do not add speculatively.
 *
 * The first three cover the mirror and the remote control. The two playlist
 * scopes were added when the browser bar was: `GET /me/playlists` returns only
 * public playlists without `playlist-read-private`, and omits collaborative
 * ones without `playlist-read-collaborative`.
 *
 * Adding to this list is not free. A refresh token carries the scopes it was
 * granted and a refresh never widens them, so anyone with an existing session
 * has to sign out and reconnect once — which is what `SetupInfo.scopesStale`
 * exists to detect. The queue needs nothing extra; it rides on
 * `user-read-playback-state`.
 */
export const SPOTIFY_SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
] as const

/**
 * Whether a stored session's granted scopes still cover what Vuelta asks for.
 *
 * Pure, and in core, so both the main process and a test can use the same rule.
 */
export function scopesSatisfied(granted: readonly string[]): boolean {
  const have = new Set(granted)
  return SPOTIFY_SCOPES.every((scope) => have.has(scope))
}
