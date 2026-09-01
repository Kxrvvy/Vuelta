/**
 * The full Authorization Code + PKCE flow — spec §4.
 *
 * The one rule this file exists to protect: Vuelta never renders a Spotify
 * login form. The system browser is opened to Spotify's real domain, where the
 * user can see the URL bar and the padlock. Vuelta never sees the password.
 */

import { shell } from 'electron'
import { DEFAULT_REDIRECT_PORT, FALLBACK_REDIRECT_PORTS, writeConfig } from '../config.js'
import { VueltaError, toVueltaError } from '../errors.js'
import { exchangeCodeForTokens, buildAuthorizeUrl } from '../spotify/client.js'
import { createPkcePair, createState } from './pkce.js'
import { startCallbackServer } from './loopback.js'

/** Long enough to find a password manager and pass a 2FA prompt, short enough to not hang forever. */
const CALLBACK_TIMEOUT_MS = 180_000

export type AuthFlowResult = {
  port: number
  redirectUri: string
  isFallbackPort: boolean
}

export async function runAuthFlow(clientId: string): Promise<AuthFlowResult> {
  const { verifier, challenge } = createPkcePair()
  const state = createState()

  const server = await startCallbackServer(state, [
    DEFAULT_REDIRECT_PORT,
    ...FALLBACK_REDIRECT_PORTS,
  ])

  try {
    await shell.openExternal(
      buildAuthorizeUrl({ clientId, redirectUri: server.redirectUri, challenge, state }),
    )

    const code = await server.waitForCode(CALLBACK_TIMEOUT_MS)

    await exchangeCodeForTokens({
      clientId,
      code,
      verifier,
      redirectUri: server.redirectUri,
    })

    writeConfig({ redirectPort: server.port })

    return { port: server.port, redirectUri: server.redirectUri, isFallbackPort: server.isFallbackPort }
  } catch (cause) {
    const error = toVueltaError(cause)
    if (server.isFallbackPort && error.code === 'auth-failed') {
      // Almost certainly a redirect-URI mismatch: we had to fall back to a port
      // the user never registered. Say so instead of echoing Spotify's wording.
      throw new VueltaError(
        'auth-failed',
        `Port ${DEFAULT_REDIRECT_PORT} was busy, so Vuelta listened on ${server.port} instead. Add ${server.redirectUri} to your Spotify app's Redirect URIs, or free up port ${DEFAULT_REDIRECT_PORT}, then try again.`,
      )
    }
    throw error
  } finally {
    // Always. A failed login must not leave the port held.
    await server.close()
  }
}
