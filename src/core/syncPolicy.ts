/**
 * When to poll next — spec §8.
 *
 * Pure arithmetic, deliberately separate from the loop that obeys it, so the
 * timing rules can be tested without waiting in real time.
 *
 * The constraint that sets these numbers: Spotify's rate limit is a rolling
 * 30-second window. Polling every second would burn it on nothing, which is
 * why the spec says 3–5 seconds and never faster.
 */

/** Spec §8: "every 3–5 seconds". The jitter below spreads calls across it. */
export const POLL_PLAYING_MS = 4000

/** Spec §8: "Poll more slowly (~10s) while paused." Nothing is moving. */
export const POLL_PAUSED_MS = 10_000

/** Never hammer, whatever the arithmetic says. */
export const MIN_POLL_MS = 3000

/** Long enough that a persistent outage stops costing anything. */
export const MAX_BACKOFF_MS = 60_000

export type PollInput = {
  isPlaying: boolean
  /** From a 429's Retry-After header, if the last attempt was rate limited. */
  retryAfterMs?: number | undefined
  /** Consecutive failed polls, for backoff. Reset to 0 on success. */
  consecutiveFailures: number
  /** 0–1. Injected so the result is deterministic under test. */
  jitter?: number
}

/**
 * Spotify asked us to wait, so wait — then add a little, because coming back
 * at exactly the permitted moment tends to earn another 429.
 */
function honourRetryAfter(retryAfterMs: number): number {
  return Math.min(MAX_BACKOFF_MS, Math.max(MIN_POLL_MS, retryAfterMs + 250))
}

export function nextPollDelay(input: PollInput): number {
  if (input.retryAfterMs !== undefined && input.retryAfterMs > 0) {
    return honourRetryAfter(input.retryAfterMs)
  }

  const base = input.isPlaying ? POLL_PLAYING_MS : POLL_PAUSED_MS

  if (input.consecutiveFailures > 0) {
    // Exponential, capped. A dropped network should not keep generating
    // traffic at the normal cadence.
    const backoff = base * 2 ** Math.min(input.consecutiveFailures, 5)
    return Math.min(MAX_BACKOFF_MS, backoff)
  }

  // ±12.5%, so repeated polls do not land in lockstep with anything else.
  const jitter = input.jitter ?? 0.5
  const spread = base * 0.25
  return Math.max(MIN_POLL_MS, Math.round(base - spread / 2 + jitter * spread))
}

/**
 * Whether a poll result should reset or increment the failure counter.
 * A 204 (no device) is not a failure — it is a designed state.
 */
export function isPollFailure(kind: 'ok' | 'no-device' | 'error'): boolean {
  return kind === 'error'
}
