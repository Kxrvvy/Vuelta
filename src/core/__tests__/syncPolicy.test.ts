import { describe, expect, it } from 'vitest'

import {
  isPollFailure,
  MAX_BACKOFF_MS,
  MIN_POLL_MS,
  nextPollDelay,
  POLL_PAUSED_MS,
  POLL_PLAYING_MS,
} from '../syncPolicy.js'

describe('poll cadence', () => {
  it('stays inside the 3–5 second band while playing', () => {
    // Spec §8: "every 3–5 seconds. Never every second."
    for (const jitter of [0, 0.25, 0.5, 0.75, 1]) {
      const delay = nextPollDelay({ isPlaying: true, consecutiveFailures: 0, jitter })
      expect(delay).toBeGreaterThanOrEqual(3000)
      expect(delay).toBeLessThanOrEqual(5000)
    }
  })

  it('slows to roughly ten seconds while paused', () => {
    const delay = nextPollDelay({ isPlaying: false, consecutiveFailures: 0, jitter: 0.5 })
    expect(delay).toBeCloseTo(POLL_PAUSED_MS, -3)
  })

  it('jitters, so repeated polls do not land in lockstep', () => {
    const low = nextPollDelay({ isPlaying: true, consecutiveFailures: 0, jitter: 0 })
    const high = nextPollDelay({ isPlaying: true, consecutiveFailures: 0, jitter: 1 })
    expect(high).toBeGreaterThan(low)
  })

  it('never polls faster than the floor', () => {
    const delay = nextPollDelay({ isPlaying: true, consecutiveFailures: 0, jitter: 0 })
    expect(delay).toBeGreaterThanOrEqual(MIN_POLL_MS)
  })
})

describe('429 handling', () => {
  it('waits at least as long as Retry-After asked', () => {
    const delay = nextPollDelay({
      isPlaying: true,
      retryAfterMs: 8000,
      consecutiveFailures: 1,
    })
    expect(delay).toBeGreaterThanOrEqual(8000)
  })

  it('adds a margin, because returning at the exact permitted moment re-trips it', () => {
    expect(nextPollDelay({ isPlaying: true, retryAfterMs: 8000, consecutiveFailures: 1 })).toBe(8250)
  })

  it('takes precedence over the normal cadence', () => {
    const delay = nextPollDelay({ isPlaying: true, retryAfterMs: 30_000, consecutiveFailures: 0 })
    expect(delay).toBeGreaterThan(POLL_PLAYING_MS)
  })

  it('is still capped', () => {
    const delay = nextPollDelay({
      isPlaying: true,
      retryAfterMs: 10 * MAX_BACKOFF_MS,
      consecutiveFailures: 1,
    })
    expect(delay).toBe(MAX_BACKOFF_MS)
  })
})

describe('failure backoff', () => {
  it('backs off exponentially', () => {
    const one = nextPollDelay({ isPlaying: true, consecutiveFailures: 1 })
    const two = nextPollDelay({ isPlaying: true, consecutiveFailures: 2 })
    const three = nextPollDelay({ isPlaying: true, consecutiveFailures: 3 })
    expect(two).toBeGreaterThan(one)
    expect(three).toBeGreaterThan(two)
  })

  it('caps the backoff', () => {
    expect(nextPollDelay({ isPlaying: true, consecutiveFailures: 99 })).toBe(MAX_BACKOFF_MS)
  })

  it('returns to the normal cadence once a poll succeeds', () => {
    const recovered = nextPollDelay({ isPlaying: true, consecutiveFailures: 0, jitter: 0.5 })
    expect(recovered).toBeCloseTo(POLL_PLAYING_MS, -3)
  })
})

describe('isPollFailure', () => {
  it('does not treat a missing device as a failure', () => {
    // 204 is a designed state, not an error — backing off because Spotify is
    // closed would make the app slow to notice it reopening.
    expect(isPollFailure('no-device')).toBe(false)
  })

  it('treats ok as success and error as failure', () => {
    expect(isPollFailure('ok')).toBe(false)
    expect(isPollFailure('error')).toBe(true)
  })
})
