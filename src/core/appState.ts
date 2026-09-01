/**
 * The application state machine — spec §7.
 *
 *   IDLE ──open──> CONNECTING ──ok──> NO_DEVICE ──device found──> PLAYING ⇄ PAUSED
 *                      │                  ▲                          │
 *                      └──auth fail───────┴──────device lost─────────┘
 *
 * A pure reducer: `(state, event) => state`. No timers, no IPC, no React, no
 * awareness of how any of this is drawn. That makes every transition below
 * directly testable in a plain Vitest file, which is the point.
 *
 * Unknown (state, event) pairs return the state unchanged rather than throwing.
 * A UI state machine that crashes on an unexpected event is worse than one that
 * ignores it, and polls arriving after a phase change are routine here.
 */

import type { VueltaErrorCode } from './contract.js'

export type Phase =
  /** First run: no Client ID yet. */
  | 'setup'
  /** Authorized-capable but not connected. Lid closed; the whole player is one click target. */
  | 'idle'
  /** OAuth in flight, or hunting for an active device. */
  | 'connecting'
  /** Authorized, but Spotify isn't running or isn't active. Happens constantly; needs a real screen. */
  | 'no-device'
  | 'playing'
  | 'paused'
  /** Terminal until retried. */
  | 'auth-failed'
  /** HTTP 403 — the user hasn't allowlisted themselves. The most common support issue. */
  | 'not-allowlisted'

export type AppError = { code: VueltaErrorCode; message: string }

export type AppState = {
  phase: Phase
  /**
   * Set alongside a phase change for fatal problems, or on its own for
   * transient ones (a dropped network) where the phase should not move.
   */
  error: AppError | null
}

export type AppEvent =
  | { type: 'LAUNCHED'; hasClientId: boolean; hasStoredSession: boolean }
  | { type: 'CLIENT_ID_SAVED' }
  | { type: 'AUTH_STARTED' }
  | { type: 'AUTH_SUCCEEDED' }
  | { type: 'AUTH_FAILED'; code: VueltaErrorCode; message: string }
  | { type: 'POLL_OK'; isPlaying: boolean }
  | { type: 'POLL_NO_DEVICE' }
  | { type: 'POLL_FAILED'; code: VueltaErrorCode; message: string }
  | { type: 'LID_CLOSED' }
  | { type: 'SIGNED_OUT' }
  | { type: 'RETRY' }

export const INITIAL_APP_STATE: AppState = { phase: 'setup', error: null }

/** Phases in which a poll result is meaningful. */
const CONNECTED_PHASES: ReadonlySet<Phase> = new Set<Phase>([
  'connecting',
  'no-device',
  'playing',
  'paused',
])

/** Errors that must stop the app rather than be retried silently. */
function phaseForError(code: VueltaErrorCode): Phase | null {
  if (code === 'not-allowlisted') return 'not-allowlisted'
  if (code === 'auth-failed' || code === 'premium-required' || code === 'no-client-id') {
    return 'auth-failed'
  }
  return null
}

export function reduce(state: AppState, event: AppEvent): AppState {
  switch (event.type) {
    case 'LAUNCHED': {
      if (!event.hasClientId) return { phase: 'setup', error: null }
      // A stored refresh token means we can reconnect without asking again.
      return { phase: event.hasStoredSession ? 'connecting' : 'idle', error: null }
    }

    case 'CLIENT_ID_SAVED':
      return { phase: 'idle', error: null }

    case 'AUTH_STARTED':
      return state.phase === 'idle' ? { phase: 'connecting', error: null } : state

    case 'AUTH_SUCCEEDED':
      // Stay in connecting: authorized is not the same as having a device.
      // The first poll decides whether we land in NO_DEVICE, PLAYING or PAUSED.
      return state.phase === 'connecting' ? { phase: 'connecting', error: null } : state

    case 'AUTH_FAILED':
      return {
        phase: phaseForError(event.code) ?? 'auth-failed',
        error: { code: event.code, message: event.message },
      }

    case 'POLL_OK':
      if (!CONNECTED_PHASES.has(state.phase)) return state
      return { phase: event.isPlaying ? 'playing' : 'paused', error: null }

    case 'POLL_NO_DEVICE':
      if (!CONNECTED_PHASES.has(state.phase)) return state
      return { phase: 'no-device', error: null }

    case 'POLL_FAILED': {
      const fatal = phaseForError(event.code)
      const error: AppError = { code: event.code, message: event.message }
      // Transient failures (network, rate limit) record the error but hold the
      // phase — a flaky poll must not tear down a working screen.
      return fatal ? { phase: fatal, error } : { ...state, error }
    }

    case 'LID_CLOSED':
      return CONNECTED_PHASES.has(state.phase) ? { phase: 'idle', error: null } : state

    case 'SIGNED_OUT':
      return { phase: 'setup', error: null }

    case 'RETRY':
      if (state.phase === 'auth-failed' || state.phase === 'not-allowlisted') {
        return { phase: 'idle', error: null }
      }
      return state.error ? { ...state, error: null } : state
  }
}
