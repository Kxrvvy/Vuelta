/**
 * Electron main entry. M0: a plain window, nothing framed or tray-bound yet —
 * that is M7.
 */

import { app, BrowserWindow, Menu, session, shell } from 'electron'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc.js'

const isDev = !app.isPackaged

/**
 * Applied to the packaged app only — Vite's dev server needs inline scripts and
 * a websocket for HMR, and the dev renderer is a local trusted origin anyway.
 *
 * `img-src` allows Spotify's image CDNs so album art and playlist covers work
 * without anyone having to rediscover why images silently fail to load.
 *
 * Three hosts, not one, and they are not interchangeable. Album art is on
 * i.scdn.co; a playlist with no custom cover gets a four-up mosaic from
 * mosaic.scdn.co; a playlist with an uploaded cover is served from
 * image-cdn-*.spotifycdn.com. Dev has no CSP at all, so a missing host here
 * does not show up until the app is packaged.
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
            "img-src 'self' data: https://i.scdn.co https://mosaic.scdn.co https://image-cdn-ak.spotifycdn.com https://image-cdn-fa.spotifycdn.com",
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
    width: 980,
    height: 680,
    // A floor low enough to be a useful small window, high enough that the
    // panel and the turntable both still have room beside each other.
    minWidth: 640,
    minHeight: 520,
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

  // Removing the menu also removes the accelerators it carried, so dev builds
  // get the two that are actually useful back. Production gets neither, which
  // is correct — there is no reason to ship a DevTools shortcut.
  //
  // Clipboard shortcuts are NOT restored here on purpose: on Windows, Ctrl+C
  // and Ctrl+V inside a text field are handled by Blink itself rather than by
  // the menu's edit roles, so pasting a Client ID still works without a menu.
  // (macOS would need them back; this app is Windows-only.)
  if (isDev) {
    window.webContents.on('before-input-event', (_event, input) => {
      if (input.type !== 'keyDown') return
      if (input.key === 'F12') window.webContents.toggleDevTools()
      if (input.control && input.key.toLowerCase() === 'r') window.webContents.reload()
    })
  }

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

// No File / Edit / View / Window bar. Electron installs a stock menu by
// default; none of it does anything this app needs, and a menu bar makes the
// window read as a document editor rather than as an object on a desk. M7
// takes this further with frameless chrome.
Menu.setApplicationMenu(null)

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
