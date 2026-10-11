/**
 * Optimistic overrides — spec §8.
 *
 * The spec calls this "the bug that would otherwise cost you a weekend":
 *
 *   Press next. The UI updates instantly. Then a poll that was already in
 *   flight arrives carrying the *old* track, and the UI snaps backwards
 *   before jumping forwards again.
 *
 * The fix is to let a user action claim a value for a few seconds. While that
 * claim is alive, poll data that contradicts it is discarded. The claim dies
 * when the server agrees with it, or when its time runs out — whichever comes
 * first. The expiry is the important half: without it, a command that silently
 * failed would freeze the UI on a lie forever.
 *
 * Applies to play, pause, next, previous, seek and volume.
 */

/** Spec §8: "a timestamp and a ~5 second TTL". */
export const OVERRIDE_TTL_MS = 5000

export type Optimistic<T> = {
  /** Claim a value. Poll data disagreeing with it is ignored until it dies. */
  claim(value: T, now: number, ttlMs?: number): void
  /** The claimed value while the claim is alive, otherwise undefined. */
  peek(now: number): T | undefined
  /**
   * Feed in what the server actually reported. If it matches the claim, the
   * claim has done its job and is retired early. Returns the value the UI
   * should use — the claim if it is still standing, else the server's.
   */
  settle(serverValue: T, now: number): T
  clear(): void
  /** True while a claim is standing. Exposed for tests and diagnostics. */
  isActive(now: number): boolean
}

export function optimistic<T>(equals: (a: T, b: T) => boolean = Object.is): Optimistic<T> {
  let value: T | undefined
  let expiresAt = 0
  let held = false

  const alive = (now: number) => held && now < expiresAt

  return {
    claim(next, now, ttlMs = OVERRIDE_TTL_MS) {
      value = next
      expiresAt = now + ttlMs
      held = true
    },

    peek(now) {
      if (!alive(now)) {
        // Let an expired claim fall away rather than lingering in memory.
        if (held && now >= expiresAt) {
          held = false
          value = undefined
        }
        return undefined
      }
      return value
    },

    settle(serverValue, now) {
      if (!alive(now)) {
        held = false
        value = undefined
        return serverValue
      }
      if (value !== undefined && equals(value, serverValue)) {
        // The server caught up. Nothing left to protect.
        held = false
        const settled = value
        value = undefined
        return settled
      }
      return value as T
    },

    clear() {
      held = false
      value = undefined
      expiresAt = 0
    },

    isActive(now) {
      return alive(now)
    },
  }
}

/**
 * Seek needs a tolerance rather than exact equality: the server will never
 * report back precisely the millisecond that was asked for, and playback has
 * moved on by the time the next poll lands.
 */
export function withinMs(tolerance: number) {
  return (a: number, b: number) => Math.abs(a - b) <= tolerance
}
