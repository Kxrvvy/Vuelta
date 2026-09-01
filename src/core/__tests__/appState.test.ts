import { describe, expect, it } from 'vitest'

import type { AppState } from '../appState.js'
import { INITIAL_APP_STATE, reduce } from '../appState.js'

/**
 * These tests run with no DOM and no React import. That is not incidental —
 * spec §5 names it as the test for whether the layer boundary is real.
 */

const at = (state: Partial<AppState>): AppState => ({ ...INITIAL_APP_STATE, ...state })

describe('launch', () => {
  it('goes to setup when no Client ID is stored', () => {
    const next = reduce(INITIAL_APP_STATE, {
      type: 'LAUNCHED',
      hasClientId: false,
      hasStoredSession: false,
    })
    expect(next.phase).toBe('setup')
  })

  it('goes to idle with a Client ID but no stored session', () => {
    const next = reduce(INITIAL_APP_STATE, {
      type: 'LAUNCHED',
      hasClientId: true,
      hasStoredSession: false,
    })
    expect(next.phase).toBe('idle')
  })

  it('reconnects straight away when a refresh token is on disk', () => {
    const next = reduce(INITIAL_APP_STATE, {
      type: 'LAUNCHED',
      hasClientId: true,
      hasStoredSession: true,
    })
    expect(next.phase).toBe('connecting')
  })
})

describe('setup and auth', () => {
  it('saving a Client ID leaves setup for idle', () => {
    expect(reduce(at({ phase: 'setup' }), { type: 'CLIENT_ID_SAVED' }).phase).toBe('idle')
  })

  it('starting auth moves idle to connecting', () => {
    expect(reduce(at({ phase: 'idle' }), { type: 'AUTH_STARTED' }).phase).toBe('connecting')
  })

  it('ignores AUTH_STARTED from a phase that cannot start auth', () => {
    const state = at({ phase: 'playing' })
    expect(reduce(state, { type: 'AUTH_STARTED' })).toBe(state)
  })

  it('stays in connecting after auth succeeds, because authorized is not connected', () => {
    // Spotify may be authorized with no active device. The first poll decides.
    expect(reduce(at({ phase: 'connecting' }), { type: 'AUTH_SUCCEEDED' }).phase).toBe('connecting')
  })

  it('routes a 403 to its own phase rather than a generic failure', () => {
    const next = reduce(at({ phase: 'connecting' }), {
      type: 'AUTH_FAILED',
      code: 'not-allowlisted',
      message: 'nope',
    })
    expect(next.phase).toBe('not-allowlisted')
    expect(next.error).toEqual({ code: 'not-allowlisted', message: 'nope' })
  })

  it('routes other auth problems to auth-failed', () => {
    const next = reduce(at({ phase: 'connecting' }), {
      type: 'AUTH_FAILED',
      code: 'auth-failed',
      message: 'bad state parameter',
    })
    expect(next.phase).toBe('auth-failed')
  })
})

describe('polling', () => {
  it('lands on playing or paused from connecting', () => {
    expect(reduce(at({ phase: 'connecting' }), { type: 'POLL_OK', isPlaying: true }).phase).toBe(
      'playing',
    )
    expect(reduce(at({ phase: 'connecting' }), { type: 'POLL_OK', isPlaying: false }).phase).toBe(
      'paused',
    )
  })

  it('moves between playing and paused', () => {
    expect(reduce(at({ phase: 'playing' }), { type: 'POLL_OK', isPlaying: false }).phase).toBe(
      'paused',
    )
    expect(reduce(at({ phase: 'paused' }), { type: 'POLL_OK', isPlaying: true }).phase).toBe(
      'playing',
    )
  })

  it('treats 204 as NO_DEVICE, not as an error', () => {
    const next = reduce(at({ phase: 'playing' }), { type: 'POLL_NO_DEVICE' })
    expect(next.phase).toBe('no-device')
    expect(next.error).toBeNull()
  })

  it('recovers from no-device when a device reappears', () => {
    expect(reduce(at({ phase: 'no-device' }), { type: 'POLL_OK', isPlaying: true }).phase).toBe(
      'playing',
    )
  })

  it('ignores polls that arrive while in setup', () => {
    const state = at({ phase: 'setup' })
    expect(reduce(state, { type: 'POLL_OK', isPlaying: true })).toBe(state)
    expect(reduce(state, { type: 'POLL_NO_DEVICE' })).toBe(state)
  })

  it('holds the phase on a transient failure and only records the error', () => {
    // A flaky network must not tear down a working screen.
    const next = reduce(at({ phase: 'playing' }), {
      type: 'POLL_FAILED',
      code: 'network',
      message: 'offline',
    })
    expect(next.phase).toBe('playing')
    expect(next.error?.code).toBe('network')
  })

  it('escalates a 403 discovered mid-session', () => {
    const next = reduce(at({ phase: 'playing' }), {
      type: 'POLL_FAILED',
      code: 'not-allowlisted',
      message: 'forbidden',
    })
    expect(next.phase).toBe('not-allowlisted')
  })

  it('clears a transient error once the next poll succeeds', () => {
    const errored = reduce(at({ phase: 'playing' }), {
      type: 'POLL_FAILED',
      code: 'rate-limited',
      message: '429',
    })
    expect(reduce(errored, { type: 'POLL_OK', isPlaying: true }).error).toBeNull()
  })
})

describe('leaving a session', () => {
  it('closing the lid returns to idle', () => {
    expect(reduce(at({ phase: 'playing' }), { type: 'LID_CLOSED' }).phase).toBe('idle')
  })

  it('does not close the lid from setup', () => {
    const state = at({ phase: 'setup' })
    expect(reduce(state, { type: 'LID_CLOSED' })).toBe(state)
  })

  it('signing out returns to setup from anywhere', () => {
    for (const phase of ['playing', 'no-device', 'not-allowlisted'] as const) {
      expect(reduce(at({ phase }), { type: 'SIGNED_OUT' }).phase).toBe('setup')
    }
  })

  it('retry leaves a terminal error phase for idle', () => {
    for (const phase of ['auth-failed', 'not-allowlisted'] as const) {
      const next = reduce(
        at({ phase, error: { code: 'not-allowlisted', message: 'x' } }),
        { type: 'RETRY' },
      )
      expect(next.phase).toBe('idle')
      expect(next.error).toBeNull()
    }
  })

  it('retry only clears the error when the phase is healthy', () => {
    const next = reduce(
      at({ phase: 'playing', error: { code: 'network', message: 'x' } }),
      { type: 'RETRY' },
    )
    expect(next.phase).toBe('playing')
    expect(next.error).toBeNull()
  })
})

describe('purity', () => {
  it('never mutates the state it is given', () => {
    const state = at({ phase: 'connecting' })
    const frozen = Object.freeze({ ...state })
    reduce(frozen, { type: 'POLL_OK', isPlaying: true })
    expect(frozen.phase).toBe('connecting')
    expect(state).toEqual({ phase: 'connecting', error: null })
  })
})
