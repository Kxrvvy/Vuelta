# Vuelta

A Windows desktop turntable that mirrors your Spotify playback.

Vuelta renders a virtual record player whose disc, label, and tonearm follow whatever is playing in
Spotify. **It does not play audio.** It is a remote control; the Spotify desktop client remains the
playback device.

> **Status: M0.** Authentication plumbing only. The current track prints as plain text and there are
> no graphics yet — that is deliberate, not unfinished. See [Milestones](#milestones).

---

## Requirements

- Windows 10/11
- Node.js **24.12.x** (see [Environment](#environment))
- **Spotify Premium**
- Your own Spotify Client ID (the app walks you through it on first run)

### Why you bring your own Client ID

Spotify caps a development-mode app at five authorized users, and since May 2025 extended-quota
applications are only accepted from organizations. So Vuelta ships open source and each user
registers their own Spotify app: every install is its own development-mode app with one authorized
user, and the cap never binds.

Setup takes about two minutes and the app's first screen walks through it. The single most common
failure is forgetting step 3 — adding your own account to your app's user list. Vuelta detects that
case specifically and shows you the fix.

---

## Environment

Node has no `virtualenv`. `node_modules/` gives dependency isolation for free, but nothing pins the
interpreter, the package manager, or exact versions. This project pins all three.

| Python | Vuelta |
| --- | --- |
| `python -m venv` (pinned interpreter) | `.node-version` + `engines.node` + `engine-strict` |
| `pip` pinned inside the venv | `packageManager` field, enforced by Corepack |
| `site-packages/` isolation | `node_modules/` (already per-project) |
| `source venv/bin/activate` | `npm run <script>` — puts `node_modules/.bin` on PATH |
| `requirements.txt` | `save-exact=true` + committed `package-lock.json` |
| `pip install -r requirements.txt` | `npm ci` |

```bash
corepack enable      # once per machine: pins npm to the version in package.json
npm ci               # exact, reproducible restore
npm run env:check    # verify interpreter, package manager, and dependency versions
npm run dev
```

`npm run env:check` prints a status table and exits non-zero if anything has drifted:

```
  node               24.12.0        OK    required >=24.12.0 <25
  npm                11.6.2         OK    pinned npm@11.6.2
  package-lock.json  present        OK    commit it — this is the reproducible manifest
  installed deps     16 in sync     OK    exact-pinned
```

### Two version pins that are load-bearing

Installing "latest everything" produces a broken tree. Both of these are deliberate:

- **Vite is pinned to 7, not 8.** `electron-vite@5` peers on Vite ≤7, which in turn means
  `@vitejs/plugin-react` must stay on 5.x — its 6.x line requires Vite 8.
- **TypeScript is pinned to 6.0.3, not 7.** TypeScript 7 (the native Go compiler) is now `latest`,
  but `typescript-eslint` requires `<6.1.0`, and type-aware linting is what enforces the layer
  boundaries below.

---

## Scripts

| Script | Does |
| --- | --- |
| `npm run dev` | Electron + Vite with HMR |
| `npm run build` | Bundle main, preload, and renderer into `out/` |
| `npm run typecheck` | `tsc --build` across all three layer projects |
| `npm run lint` | ESLint, including the layer-boundary rules |
| `npm test` | Vitest over `core/` |
| `npm run verify` | env check → typecheck → lint → test |

---

## Architecture

Four layers, each talking only to its neighbours.

```
src/skins/   receives only RenderState + Actions. No fetch, no tokens, no Spotify awareness.
src/views/   composes skins into the top and console views.
src/app/     screens and the React shell.
src/core/    store, state machine, contract.  ← no React, no DOM, no Node
src/main/    PKCE auth, token storage, API client.  ← the only layer that knows Spotify exists
```

The governing principle: **the thing that knows about Spotify and the thing that draws a turntable
must never know about each other.** That is what makes a future photoreal renderer a swap rather
than a rewrite.

### The boundaries are enforced, not just documented

Two independent mechanisms, because a rule nothing checks is a rule that decays:

1. **The compiler.** `tsconfig.core.json` gives `core/` neither the `DOM` lib nor Node types, so
   `document`, `window`, and `process` do not exist there. If `core/` ever reaches for the DOM, the
   build stops.
2. **The linter.** `eslint.config.mjs` declares per-directory import zones — `core/` may not import
   React or Electron; `skins/` may not import from `main/`; the renderer may not import from
   `main/` at all, only through the preload bridge.

To confirm they are live, add `import React from 'react'` to any file in `src/core/` and run
`npm run lint`. It fails, with an explanation.

### Security posture

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The renderer's entire view of
the outside world is the `VueltaBridge` type in `src/core/contract.ts`. Access and refresh tokens
never leave the main process; the refresh token is encrypted with Electron `safeStorage` (DPAPI via
Windows Credential Manager) and, if secure storage is unavailable, is **not persisted at all**
rather than written in plain text.

Authorization is Authorization Code with PKCE — no client secret, because a desktop binary cannot
keep one. The login always happens in your real browser on Spotify's own domain; Vuelta never shows
a Spotify login form and never sees your password.

---

## Milestones

Numbering starts at zero because M0 produces nothing visible. Each milestone is defined by what you
can *see* when it is finished.

| | Done when | |
| --- | --- | --- |
| **M0** | Electron shell, Client ID setup, PKCE auth, current track as plain text. No graphics. | **← here** |
| M1 | Polling, local extrapolation, reconciliation, optimistic overrides, on a plain progress bar. | |
| M2 | Disc spins, album art in the center label, tonearm sweeps. Read-only. | |
| M3 | Disc click plays/pauses. Arm drags to scrub. | |
| M4 | Lid opens and closes; the launch sequence works. | |
| M5 | Console view, three buttons, volume knob. | |
| M6 | Record-swap animation on the track boundary via queue pre-fetch. | |
| M7 | Tray icon, always-on-top, frameless window, packaged installer. | |

Auth comes first, before a single pixel of turntable, because it is the only part of this project
that can fail in a way you cannot design around.

---

## Licence

MIT. Not affiliated with Spotify.
