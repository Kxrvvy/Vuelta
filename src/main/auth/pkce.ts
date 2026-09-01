/**
 * PKCE primitives — spec §4.
 *
 * Authorization Code with PKCE, no client secret. A desktop binary cannot keep
 * a secret, so there is none to keep.
 *
 * Why PKCE matters here specifically: the redirect lands on loopback, where
 * another local process could in principle race to grab the authorization
 * code. The verifier never leaves this process's memory, so an intercepted
 * code is useless without it.
 *
 * `node:crypto` only — no dependency needed for any of this.
 */

import { createHash, randomBytes } from 'node:crypto'

function base64url(input: Buffer): string {
  return input.toString('base64url')
}

export type PkcePair = {
  /** Kept in memory for the lifetime of one auth attempt. Never written to disk. */
  verifier: string
  /** S256 hash of the verifier; the only half that travels to Spotify. */
  challenge: string
}

export function createPkcePair(): PkcePair {
  // 32 random bytes → 43 base64url characters, inside Spotify's 43–128 range.
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/** CSRF guard for the callback. Validated on return; a mismatch aborts the flow. */
export function createState(): string {
  return base64url(randomBytes(16))
}
