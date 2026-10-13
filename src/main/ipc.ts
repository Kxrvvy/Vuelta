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
  CommandResult,
  LyricsResult,
  PlayerPoll,
  PlaylistsResult,
  PlaylistTracksResult,
  QueueResult,
  SaveClientIdResult,
  SetupInfo,
} from '../core/contract.js'
import { scopesSatisfied } from '../core/contract.js'
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
import { fetchLyrics } from './lyrics/client.js'
import {
  addToQueue,
  forgetAccessToken,
  getPlayer,
  getPlaylists,
  getPlaylistTracks,
  getQueue,
  next,
  pause,
  play,
  playContext,
  previous,
  seek,
  setVolume,
} from './spotify/client.js'
import { clearSession, hasStoredSession, isSecureStorageAvailable } from './tokens.js'

function currentSetup(): SetupInfo {
  const config = readConfig()
  return {
    clientId: config.clientId,
    redirectUri: redirectUriFor(config.redirectPort),
    redirectPort: config.redirectPort,
    portIsFallback: config.redirectPort !== DEFAULT_REDIRECT_PORT,
    hasStoredSession: hasStoredSession(),
    // Only meaningful when there is a session to be stale. A fresh connect
    // always grants the current list, so first-run must not be flagged.
    scopesStale: hasStoredSession() && !scopesSatisfied(config.grantedScopes),
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

  // --- playback control ----------------------------------------------------
  // Each command module function already returns a CommandResult rather than
  // throwing, so these handlers only have to supply the Client ID.

  const withClientId =
    (run: (clientId: string) => Promise<CommandResult>) => async (): Promise<CommandResult> => {
      const { clientId } = readConfig()
      if (!clientId) {
        return { ok: false, code: 'no-client-id', message: 'No Client ID has been set yet.' }
      }
      return run(clientId)
    }

  ipcMain.handle(CHANNELS.play, withClientId(play))
  ipcMain.handle(CHANNELS.pause, withClientId(pause))
  ipcMain.handle(CHANNELS.next, withClientId(next))
  ipcMain.handle(CHANNELS.previous, withClientId(previous))

  ipcMain.handle(CHANNELS.seek, async (_event, positionMs: unknown): Promise<CommandResult> => {
    if (typeof positionMs !== 'number' || !Number.isFinite(positionMs)) {
      return { ok: false, code: 'unknown', message: 'Seek position must be a number.' }
    }
    return withClientId((clientId) => seek(clientId, positionMs))()
  })

  ipcMain.handle(CHANNELS.setVolume, async (_event, percent: unknown): Promise<CommandResult> => {
    if (typeof percent !== 'number' || !Number.isFinite(percent)) {
      return { ok: false, code: 'unknown', message: 'Volume must be a number.' }
    }
    return withClientId((clientId) => setVolume(clientId, percent))()
  })

  // --- playlists and the queue ---------------------------------------------
  // Each read already maps its own failures onto a result union, so these
  // handlers only supply the Client ID and validate their arguments.

  const noClientId = { ok: false, code: 'no-client-id', message: 'No Client ID has been set yet.' } as const

  ipcMain.handle(CHANNELS.getPlaylists, async (): Promise<PlaylistsResult> => {
    const { clientId } = readConfig()
    if (!clientId) return noClientId
    return getPlaylists(clientId)
  })

  ipcMain.handle(
    CHANNELS.getPlaylistTracks,
    async (_event, playlistId: unknown): Promise<PlaylistTracksResult> => {
      if (typeof playlistId !== 'string' || playlistId.length === 0) {
        return { ok: false, code: 'unknown', message: 'A playlist id is required.' }
      }
      const { clientId } = readConfig()
      if (!clientId) return noClientId
      return getPlaylistTracks(clientId, playlistId)
    },
  )

  ipcMain.handle(CHANNELS.getQueue, async (): Promise<QueueResult> => {
    const { clientId } = readConfig()
    if (!clientId) return noClientId
    return getQueue(clientId)
  })

  ipcMain.handle(
    CHANNELS.playContext,
    async (_event, contextUri: unknown, offsetUri: unknown): Promise<CommandResult> => {
      if (typeof contextUri !== 'string' || !contextUri.startsWith('spotify:')) {
        return { ok: false, code: 'unknown', message: 'A Spotify context URI is required.' }
      }
      const offset =
        typeof offsetUri === 'string' && offsetUri.startsWith('spotify:') ? offsetUri : undefined
      return withClientId((clientId) => playContext(clientId, contextUri, offset))()
    },
  )

  ipcMain.handle(CHANNELS.addToQueue, async (_event, trackUri: unknown): Promise<CommandResult> => {
    if (typeof trackUri !== 'string' || !trackUri.startsWith('spotify:')) {
      return { ok: false, code: 'unknown', message: 'A Spotify track URI is required.' }
    }
    return withClientId((clientId) => addToQueue(clientId, trackUri))()
  })

  // Needs no client ID: LRCLIB is not Spotify and wants no credentials. The
  // shape is checked here rather than trusted, like every other argument that
  // crosses this boundary, because what arrives is whatever the renderer sent.
  ipcMain.handle(CHANNELS.getLyrics, async (_event, query: unknown): Promise<LyricsResult> => {
    const value = query as Partial<Record<string, unknown>> | null
    const title = typeof value?.title === 'string' ? value.title.trim() : ''
    const artist = typeof value?.artist === 'string' ? value.artist.trim() : ''
    const album = typeof value?.album === 'string' ? value.album.trim() : ''
    const durationMs = typeof value?.durationMs === 'number' ? value.durationMs : 0

    if (title.length === 0 || artist.length === 0) {
      return { ok: true, lyrics: null }
    }
    return fetchLyrics({ title, artist, album, durationMs })
  })
}
