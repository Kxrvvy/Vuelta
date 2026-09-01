# Security model

Vuelta holds credentials for a user's Spotify account. This document states where every sensitive
value lives, what protects it, and which rules are enforced mechanically rather than by convention.

Run `npm run security:check` to verify the enforced ones. It is part of `npm run verify`.

---

## The short version

**There is no `.env` secret to protect, by design.** Vuelta uses Authorization Code with PKCE
specifically because a desktop binary cannot keep a secret. There is no client secret to leak, and
the Client ID is not confidential.

The one genuinely sensitive value at rest — the refresh token — is encrypted with Windows DPAPI and
never touches a config file, an env file, or the renderer.

---

## Where each value lives

| Value | Secret? | Location | Protection |
| --- | --- | --- | --- |
| Spotify **Client ID** | No | `%APPDATA%\Vuelta\config.json`, plain JSON | None needed — it is a public identifier |
| **Client secret** | — | **Does not exist** | PKCE removes the need for one |
| PKCE **code verifier** | Yes | Main-process memory, one auth attempt | Never written to disk; never leaves the process |
| OAuth **`state`** | Yes (CSRF) | Main-process memory | Validated on callback before anything else is trusted |
| **Authorization code** | Yes | Main-process memory, single use | Useless to an interceptor without the verifier |
| **Access token** | Yes | Main-process memory only | Never crosses IPC, never written to disk |
| **Refresh token** | Yes | `%APPDATA%\Vuelta\session.bin` | Electron `safeStorage` → Windows DPAPI, bound to your OS user account |

### Why the Client ID is in plain config and not in `.env`

Spotify caps a development-mode app at five authorized users, and extended quota is closed to
individuals. So every user registers their own Spotify app and enters their own Client ID on first
run. It has to be a **runtime setting**, not a build-time constant — baking one into the binary
would break the distribution model outright, and would not improve security, because a Client ID is
a public identifier that appears in the authorization URL anyway.

### Why the refresh token is not in `.env`

A `.env` file is plaintext on disk. `safeStorage` encrypts with a key held by Windows and tied to
your user account, so the ciphertext is useless if copied to another machine or read by another
user. Moving the token to `.env` would be a strict downgrade.

If `safeStorage.isEncryptionAvailable()` returns false, Vuelta **declines to persist the token at
all** and asks you to reconnect next launch. It never falls back to plaintext:

```ts
export function saveRefreshToken(token: string): void {
  if (!isSecureStorageAvailable()) {
    // Deliberately a no-op rather than a plaintext write.
    return
  }
  writeFileSync(sessionPath(), safeStorage.encryptString(token))
}
```

---

## Why `.env` must never hold a secret here

electron-vite does **not** read `.env` at runtime. It **inlines** values into the JavaScript bundle
at build time, so anything in `.env` is compiled into `out/` and shipped inside the installer as
readable text.

| Prefix | Inlined into |
| --- | --- |
| `MAIN_VITE_*` | main process bundle |
| `PRELOAD_VITE_*` | preload bundle |
| `RENDERER_VITE_*` | renderer bundle |
| `VITE_*` | **all three, including the renderer** |

`npm run security:check` fails the build if any variable in `.env` or `.env.example` has a
secret-shaped name (`SECRET`, `TOKEN`, `PASSWORD`, `PRIVATE`, `_KEY`, …) or uses the bare `VITE_`
prefix that reaches the renderer.

---

## Process hardening

The renderer is treated as untrusted. Its entire view of the outside world is the six-method
`VueltaBridge` in `src/core/contract.ts`.

```ts
webPreferences: {
  preload: join(__dirname, '../preload/preload.js'),
  contextIsolation: true,   // renderer JS cannot touch preload internals
  nodeIntegration: false,   // no require, no fs, no process
  sandbox: true,            // OS-level sandbox
}
```

Verified live over the DevTools protocol: `require`, `process`, `ipcRenderer`, `module`, `Buffer`
and `__dirname` are all absent from `window` in the running renderer, and `window.vuelta` exposes
exactly six methods. `security:check` fails if any of these three settings is negated or removed.

**Tokens never cross IPC.** Main returns only the narrow `PlaybackSnapshot` projection — track,
artist, album, art URL, progress, device name. Raw Spotify response bodies are never forwarded.

### Navigation and content

- `setWindowOpenHandler` denies every new window and routes the URL to the system browser.
- `will-navigate` is blocked for anything but the dev-server origin, so the app frame cannot be
  navigated away from its own renderer.
- A Content-Security-Policy is applied in packaged builds: `default-src 'self'`, `connect-src
  'self'`, `form-action 'none'`, `frame-ancestors 'none'`, with `img-src` allowing only Spotify's
  CDN for album art.

---

## Authentication

- **Authorization Code with PKCE**, no client secret.
- The login always opens in the **system browser** on Spotify's real domain. Vuelta never renders a
  Spotify login form and never sees your password. `setWindowOpenHandler` enforces this even if a
  link tries to open in-app.
- The loopback listener binds `127.0.0.1` explicitly — never `localhost`, which can resolve to `::1`
  and would not match the registered redirect URI.
- `state` is validated before any other callback parameter is read; a mismatch aborts the flow.
- The listener is closed in a `finally` block, so a failed or abandoned login never leaves port 8888
  held.
- The callback server accepts one result and shuts down; it is not a persistent local service.

### Scopes

Exactly three, and no more:

```
user-read-playback-state
user-modify-playback-state
user-read-currently-playing
```

---

## Known accepted risks

- **Unsigned installer.** Windows SmartScreen will warn on first run. Code signing certificates cost
  hundreds per year and are not justified for this project. Documented rather than fixed.
- **Loopback redirect.** Another local process could in principle race for the authorization code.
  PKCE is the mitigation: the verifier never leaves Vuelta's memory, so an intercepted code is
  useless.
- **`%APPDATA%\Vuelta\config.json` is world-readable to your OS user.** It contains only the Client
  ID, which is not confidential.

## Reporting

Open an issue, or for anything you believe is exploitable, contact the maintainer privately rather
than filing publicly.
