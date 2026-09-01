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
  transitionPhase: 'idle' | 'lifting' | 'swapping' | 'dropping'
  view: 'top' | 'console'
}

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
  view: 'top',
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
   * Wall-clock ms at which this snapshot was received. M1's reconciler needs
   * it to know how stale the reading is before easing toward it.
   */
  fetchedAt: number
}

/**
 * `GET /me/player` returning 204 with an empty body is not an error — it is
 * the NO_DEVICE state, and it happens constantly. Modelling it as a variant
 * rather than a thrown error is what keeps that from being handled as a crash.
 */
export type PlayerPoll =
  | { kind: 'ok'; snapshot: PlaybackSnapshot }
  | { kind: 'no-device' }
  | { kind: 'error'; code: VueltaErrorCode; message: string }

// ---------------------------------------------------------------------------
// Errors and setup
// ---------------------------------------------------------------------------

export type VueltaErrorCode =
  /** HTTP 403 — the user has not allowlisted themselves on their own Spotify app. */
  | 'not-allowlisted'
  /** Playback control requires Premium. */
  | 'premium-required'
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
}

/** Spotify Client IDs are 32 hex characters. Shared so both sides validate identically. */
export const CLIENT_ID_PATTERN = /^[0-9a-f]{32}$/i

/** Spec: these three scopes and nothing else. Do not add speculatively. */
export const SPOTIFY_SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
] as const
