/**
 * Plain, non-secret configuration.
 *
 * The Client ID lives here rather than in a compile-time constant because of
 * the distribution model (spec §3): every user registers their own Spotify app
 * and brings their own Client ID, which is how Vuelta sidesteps the five-user
 * cap. A Client ID is not a secret, so plain JSON is the correct home for it.
 *
 * The refresh token is emphatically NOT stored here — see tokens.ts.
 */

import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Spotify requires an exact redirect-URI match, so the port cannot be
 * ephemeral. Explicit loopback IP, never `localhost` — Spotify treats the two
 * as different strings, and `localhost` may resolve to ::1.
 */
export const DEFAULT_REDIRECT_PORT = 8888
export const FALLBACK_REDIRECT_PORTS = [8889, 8890, 8891]

export function redirectUriFor(port: number): string {
  return `http://127.0.0.1:${port}/callback`
}

export type VueltaConfig = {
  clientId: string | null
  /** The port last successfully used, so the setup screen can show the truth. */
  redirectPort: number
}

const DEFAULTS: VueltaConfig = {
  clientId: null,
  redirectPort: DEFAULT_REDIRECT_PORT,
}

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

export function readConfig(): VueltaConfig {
  try {
    const raw = JSON.parse(readFileSync(configPath(), 'utf8')) as Partial<VueltaConfig>
    return {
      clientId: typeof raw.clientId === 'string' && raw.clientId.length > 0 ? raw.clientId : null,
      redirectPort:
        typeof raw.redirectPort === 'number' ? raw.redirectPort : DEFAULTS.redirectPort,
    }
  } catch {
    // Missing or corrupt config is the first-run case, not an error.
    return { ...DEFAULTS }
  }
}

export function writeConfig(patch: Partial<VueltaConfig>): VueltaConfig {
  const next = { ...readConfig(), ...patch }
  writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf8')
  return next
}

/**
 * Spotify Client IDs are 32 lowercase hex characters. Validating here turns
 * the single most likely typo into an immediate, specific message instead of
 * an opaque failure three steps later in the browser.
 */
export function normalizeClientId(input: string): string | null {
  const trimmed = input.trim()
  return /^[0-9a-f]{32}$/i.test(trimmed) ? trimmed.toLowerCase() : null
}
