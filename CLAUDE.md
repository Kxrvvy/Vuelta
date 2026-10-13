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

## The three looks

The machine wears one of three compositions, switched from the browser bar or with keys 1/2/3.
Session-only; starts on **Main**.

| | |
|---|---|
| **Main** | The whole machine, centred, now-playing panel at the right. The original view. |
| **Lyrics** | Machine left, a column of synced lyrics at the side **in place of** the panel. |
| **Close-up** | A flat-lay: sleeve, record and arm seen from almost overhead, **no machine at all**. The machine survives in an inset at the top left. |

- The lyrics column is **content, not chrome**: it does not fade with the click gesture, and it
  reserves the right edge so the camera frames the machine beside it.
- The close-up draws **one scene through two cameras** into two scissored regions of one canvas.
  Giving any `useFrame` a priority hands R3F's render loop to us, so `scene/Viewports.tsx` draws
  every frame in every look. Do not add a second `<Canvas>`.
- The inset is not raycast. Its DOM frame is what catches a click on it; without that the click
  reads as empty field and dismisses the chrome.
- **Clicking the sleeve slides the record in and out of it** — purely visual, playback untouched.
  The disc stays the play/pause target, so the two gestures never collide. The *sleeve* moves, not
  the record, so the arm goes on tracking the groove it is playing.

## Layers

`skins/3d/layers.ts` decides which camera sees what, because the close-up and its inset draw the
same scene on the same frame and a part cannot be hidden by unmounting it.

| Layer | What | Seen by |
|---|---|---|
| `COMMON` | record, tonearm | every camera |
| `MACHINE` | cabinet, lid, counter, knob, Open button, **and the platter, slipmat and spindle** | main, lyrics, inset |
| `FLATLAY` | the album sleeve | close-up only |

- Apply one with `<OnLayer value={...}>`, which traverses on every commit — `Object3D.layers` is
  not inherited, and meshes built after the first render would otherwise keep layer 0.
- **`Viewports` keeps `raycaster.layers.mask` equal to the main camera's.** `Raycaster.layers`
  defaults to layer 0 alone, so moving the cabinet off it would make the lid, the knob and the Open
  button unpickable in every view at once. The rule it states is the right one anyway: what can be
  clicked is what can be seen.

## Lyrics

**Spotify's Web API has no lyrics endpoint.** The Spotify client's own lyrics come from an internal
service that is not part of the API and must not be called. Lyrics come from **LRCLIB**
(lrclib.net) instead: free, keyless, time-synced.

- One lookup per track, **only while the lyrics view is open**, cached for the session including
  misses. Nothing is sent in the other two looks. See SECURITY.md.
- Parsing and the which-line-now rule are pure, in `core/lyrics.ts`. The fetch is in
  `main/lyrics/client.ts` — not in `spotify/client.ts`, which maps every 403 to `not-allowlisted`.
- Any non-200 means "no lyrics", never an error screen: an unmatched lookup was observed returning
  503 rather than the documented 404.
- Read the active line from the **live state ref**, never from `readout` — that updates at
  `READOUT_HZ` (4), which would make every line up to 250ms late.

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
