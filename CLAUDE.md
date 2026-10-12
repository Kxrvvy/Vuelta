# Vuelta — Project Instructions

Read `vuelta-spec.md` for full context. This file is the short version plus the rules that must not be broken.

## What this is

A Windows desktop app (Electron + TypeScript + React) that renders a virtual vinyl turntable mirroring the user's Spotify playback. **It does not play audio.** It is a remote control; the Spotify desktop client is the playback device. All commands go through Spotify's Web API over the internet.

## Architecture rules

**Layer boundaries are absolute.**

```
skins/  →  receives only RenderState + Actions. No fetch. No tokens. No Spotify awareness.
core/   →  pure logic. No React imports. No DOM. Must run in a plain Vitest file.
main/   →  auth, token storage, all HTTP. The only layer that knows Spotify exists.
```

If `core/` imports React, or a skin imports an API client, the boundary is broken.

**Never animate through React state.** `armAngle` and `progressMs` must not live in `useState`. Core owns them and notifies subscribers imperatively; skins write `transform` directly via refs. Animating through React state re-renders the turntable 60×/second and stutters.

**Two animation strategies.** Continuous values (arm, platter) use hand-written `requestAnimationFrame`. Discrete sequences (lid, record swap) use a timeline library. Do not merge them.

**One module owns `progressMs`.** The poll, the local clock, and the user's drag all want to write it. Only the clock module writes; the reconciler nudges, dragging suspends both.

## Playback sync rules

- Poll `GET /me/player` every **3–5 seconds**, never faster. 10s while paused.
- Extrapolate locally between polls with rAF.
- Reconcile by **easing** toward truth, not snapping, unless drift > ~2s.
- Every user action writes an **optimistic override** with a ~5s TTL. Contradicting poll data is discarded while the override lives. Without this, in-flight polls make the UI jump backwards.
- `seek` commits on drag release only, never during the drag.
- `volume` throttled to ~1 call per 400ms.
- Handle 429 with `Retry-After`.
- `GET /me/player` returning **204 with an empty body is not an error** — it is the NO_DEVICE state.

## Auth rules

- Authorization Code with **PKCE**. No client secret, ever.
- Redirect URI is a **fixed port**: `http://127.0.0.1:8888/callback`. Explicit IP, not `localhost`.
- Validate the `state` parameter on callback.
- Refresh token → Electron `safeStorage`. Never plaintext.
- Client ID is **not** secret. It is a first-run user setting in plain config, because each user brings their own (see distribution model in the spec).
- Never render a Spotify login form inside the app. Always open the system browser to Spotify's real domain.

## Scopes

`user-read-playback-state`, `user-modify-playback-state`, `user-read-currently-playing`,
`playlist-read-private`, `playlist-read-collaborative`

Nothing else. Do not add scopes speculatively.

The first three cover the mirror and the remote control. The two playlist scopes arrived with the
browser bar: `GET /me/playlists` returns only public playlists without `playlist-read-private` and
omits collaborative ones without `playlist-read-collaborative`. **The queue needs neither** —
`GET /me/player/queue` rides on `user-read-playback-state`.

Adding to this list is not free. A refresh token carries the scopes it was granted and **a refresh
never widens them**, so every existing user must sign out and reconnect once. `SetupInfo.scopesStale`
exists to detect exactly that, and the browser bar offers one Reconnect button instead of letting
the read fail with a 403.

## Domain model

- **One track = one record.** Center label is that track's album art.
- Arm sweep: `REST_ANGLE` −12°, `START_ANGLE` 0°, `END_ANGLE` 22°.
- **Disc click** = play/pause. **Arm** = drag only.
- **Cue-lever pause.** Pause lifts the arm a few millimetres and it *hovers at its current angle*. It does not return to the cradle. The arm stays draggable while paused, and seek still commits on release. The platter still spins down.
- **Opening the lid plays nothing.** It is mechanical: the lid rises and the machine waits. Playback starts when the **disc** is clicked, which issues the same bodiless `PUT /me/player/play` and resumes the last context.
- **Closing the lid is the stop gesture** — only then does the arm return to `REST_ANGLE`. Closing the lid also pauses playback. The asymmetry with opening is deliberate.
- **There is no stop button.** Spotify has no stop endpoint, and the lid is the stop gesture.
- Volume knob: **click and hold, then slide horizontally**. Not vertical, not circular. Scroll wheel works only while the pointer is over the knob. The knob still rotates visually.
- **Platter speed: 16⅔ rpm**, one revolution every 3.6s — deliberately half of life. A real LP
  turns once every 1.8s, which is accurate and reads as hurried. `PLATTER_RPM` in
  `core/contract.ts` is the only authority for the rate; `LP_RPM` beside it keeps the true figure.
- **Mirror-plus-chooser, not a library.** Playlists and the queue are browsable from the browser
  bar, and that is the whole of it: **no search, no album or artist views, no editing, no library
  browser.** Vuelta still shows what Spotify is playing — it only lets you choose which record
  goes on. This retires the original "no playlist UI" rule; do not read it as licence to widen
  further.

## Track transitions

Anticipated, not reactive. Pre-fetch `GET /me/player/queue` at track start. Begin the swap when the **local clock** reads ~2000ms remaining, not when a poll reports the change. Total animation budget 2–3 seconds.

## Milestones

**M = milestone.** Numbering starts at zero because M0 produces nothing visible. Each is defined by what is visible when it's done.

| | Done when |
|---|---|
| **M0** | Electron shell, Client ID setup screen, PKCE auth. Current track printed as plain text. **No graphics.** |
| **M1** | Polling, local extrapolation, reconciliation, optimistic overrides. Numbers count up smoothly on a plain HTML progress bar. Still no turntable. |
| **M2** | Disc spins, album art in the center label, tonearm sweeps with the song. Read-only — clicks do nothing. |
| **M3** | Disc click plays/pauses. Arm drags to scrub. |
| **M4** | Lid opens and closes; the launch sequence works. |
| **M5** | Console view with front panel, three buttons, volume knob. |
| **M6** | Record-swap animation lands on the track boundary using queue pre-fetch. |
| **M7** | Tray icon, always-on-top toggle, frameless window, NO_DEVICE screen, packaged installer. |

**Currently on M0.** Do not build turntable UI during M0.

The split at M1 matters: everything up to there is plumbing with real unknowns. Everything after is drawing and animating, where nothing can surprise you — only take time.

## Constraints that are not negotiable

- Spotify Premium required.
- Five authorized users per Client ID; extended quota is closed to individuals. Hence the bring-your-own-Client-ID distribution model.
- `audio-features` and `audio-analysis` return 403. No BPM, no beat sync. Do not design features that need them.

## Style

- Hand-written CSS for the skin. Utility classes fight custom transforms and gradients.
- Keep every Spotify API call behind one module. Spotify changes their terms often; a migration should touch one file.
