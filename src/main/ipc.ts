/**
 * The IPC surface. This is the whole boundary between the layer that holds
 * tokens and the layer that draws things.
 *
 * Nothing here ever returns an access token, a refresh token, or a raw Spotify
 * response body. The renderer receives only the narrow projections defined in
 * core/contract.ts.
 */

import { clipboard, ipcMain } from 'electron'
import type {
  AuthOutcome,
  PlayerPoll,
  SaveClientIdResult,
  SetupInfo,
} from '../core/contract.js'
import { runAuthFlow } from './auth/flow.js'
import { CHANNELS } from './channels.js'
import {
  DEFAULT_REDIRECT_PORT,
  normalizeClientId,
  readConfig,
  redirectUriFor,
  writeConfig,
} from './config.js'
import { toVueltaError } from './errors.js'
import { forgetAccessToken, getPlayer } from './spotify/client.js'
import { clearSession, hasStoredSession, isSecureStorageAvailable } from './tokens.js'

function currentSetup(): SetupInfo {
  const config = readConfig()
  return {
    clientId: config.clientId,
    redirectUri: redirectUriFor(config.redirectPort),
    redirectPort: config.redirectPort,
    portIsFallback: config.redirectPort !== DEFAULT_REDIRECT_PORT,
    hasStoredSession: hasStoredSession(),
    secureStorageAvailable: isSecureStorageAvailable(),
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle(CHANNELS.getSetup, (): SetupInfo => currentSetup())

  ipcMain.handle(CHANNELS.saveClientId, (_event, raw: unknown): SaveClientIdResult => {
    if (typeof raw !== 'string') {
      return { ok: false, message: 'That does not look like a Client ID.' }
    }
    const clientId = normalizeClientId(raw)
    if (!clientId) {
      return {
        ok: false,
        message:
          'A Spotify Client ID is 32 characters, digits and letters a–f only. Copy it from your app in the Spotify developer dashboard.',
      }
    }
    writeConfig({ clientId })
    return { ok: true, setup: currentSetup() }
  })

  ipcMain.handle(CHANNELS.startAuth, async (): Promise<AuthOutcome> => {
    const { clientId } = readConfig()
    if (!clientId) {
      return { ok: false, code: 'no-client-id', message: 'No Client ID has been set yet.' }
    }
    if (!isSecureStorageAvailable()) {
      // Better to say so up front than to authorize and silently forget the
      // session on quit. We never write the token in plaintext instead.
      return {
        ok: false,
        code: 'secure-storage-unavailable',
        message:
          'Windows secure storage is unavailable, so Vuelta cannot save your session safely. It will not store the token in plain text.',
      }
    }

    try {
      await runAuthFlow(clientId)
      return { ok: true }
    } catch (cause) {
      const error = toVueltaError(cause)
      return { ok: false, code: error.code, message: error.message }
    }
  })

  ipcMain.handle(CHANNELS.copyText, (_event, text: unknown): void => {
    if (typeof text === 'string') clipboard.writeText(text)
  })

  ipcMain.handle(CHANNELS.signOut, (): void => {
    clearSession()
    forgetAccessToken()
  })

  ipcMain.handle(CHANNELS.getPlayer, async (): Promise<PlayerPoll> => {
    const { clientId } = readConfig()
    if (!clientId) {
      return { kind: 'error', code: 'no-client-id', message: 'No Client ID has been set yet.' }
    }
    // getPlayer never throws — it maps every failure onto the PlayerPoll union.
    return getPlayer(clientId)
  })
}
