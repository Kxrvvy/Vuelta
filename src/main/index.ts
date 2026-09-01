/**
 * Electron main entry. M0: a plain window, nothing framed or tray-bound yet —
 * that is M7.
 */

import { app, BrowserWindow, session, shell } from 'electron'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc.js'

const isDev = !app.isPackaged

/**
 * Applied to the packaged app only — Vite's dev server needs inline scripts and
 * a websocket for HMR, and the dev renderer is a local trusted origin anyway.
 *
 * `img-src` already allows Spotify's CDN so album art works at M2 without
 * anyone having to rediscover why images silently fail to load.
 */
function applyContentSecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https://i.scdn.co",
            "connect-src 'self'",
            "form-action 'none'",
            "frame-ancestors 'none'",
          ].join('; '),
        ],
      },
    })
  })
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 760,
    height: 580,
    minWidth: 560,
    minHeight: 460,
    show: false,
    backgroundColor: '#141210',
    title: 'Vuelta',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      // The three settings that make the preload bridge the only way in.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // Avoid the white flash before React paints.
  window.once('ready-to-show', () => window.show())

  // Dev-only convenience. `isDev` is checked here as well as in the value
  // itself so that a packaged build cannot open DevTools even if someone
  // shipped a .env with the flag turned on.
  if (isDev && import.meta.env.MAIN_VITE_OPEN_DEVTOOLS === 'true') {
    window.webContents.openDevTools({ mode: 'detach' })
  }

  // Any link that wants a new window opens in the real browser instead. Vuelta
  // must never host Spotify's login form, and this is the belt to that braces.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Nothing may navigate the app frame away from its own renderer.
  window.webContents.on('will-navigate', (event, url) => {
    const rendererUrl = process.env['ELECTRON_RENDERER_URL']
    if (!(isDev && rendererUrl && url.startsWith(rendererUrl))) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && rendererUrl) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * Pin the app name before anything reads a path from it.
 *
 * `app.getPath('userData')` is derived from the app name, and the name is
 * otherwise inferred from whichever package.json Electron happens to find.
 * Launching the built bundle directly resolves it to "Electron", while
 * `npm run dev` and the packaged build resolve it to "vuelta" — which would
 * silently scatter the config and the stored session across two directories
 * depending on how the app was started. Setting it explicitly makes one
 * location true for every launch mode.
 */
app.setName('Vuelta')

// Windows taskbar grouping and notification identity.
app.setAppUserModelId('com.vuelta.app')

// A second instance would race for port 8888 and for the config file.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [existing] = BrowserWindow.getAllWindows()
    if (existing) {
      if (existing.isMinimized()) existing.restore()
      existing.focus()
    }
  })

  void app.whenReady().then(() => {
    if (!isDev) applyContentSecurityPolicy()
    registerIpcHandlers()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}
