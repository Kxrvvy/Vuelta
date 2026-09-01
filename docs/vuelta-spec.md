# Vuelta — Master Spec

A Windows desktop turntable that mirrors your Spotify playback.

Last updated: September 2026. This document is the single source of truth for the project. Everything in it was decided deliberately; where something is still open, it says so.

---

## 1. What it is

Vuelta renders a photorealistic-feeling virtual record player on your desktop. Whatever is playing in Spotify appears as a spinning record with the album art as its center label. You can drop the needle, scrub by dragging the tonearm, and pause by clicking the disc.

**Vuelta does not play audio.** It is a remote control. The Spotify desktop client remains the actual playback device. Vuelta sends commands to Spotify's servers, which relay them to your client.

**Reference point:** MD Vinyl (iOS/Android). Same underlying mechanism, different body. MD Vinyl is a widget-first mobile app; Vuelta is a full interactive desktop turntable with a lid, two views, and physical controls.

**Name:** Vuelta. Spanish for a turn, a lap, or a return. Chosen over Ember, which collides badly with Ember.js in developer search results. Existing "Vuelta" collisions are all cycling races, a different category entirely.

---

## 2. Hard constraints

Verified against Spotify's developer documentation as of August 2026.

| Constraint | Detail |
|---|---|
| Premium required | The app owner must hold active Spotify Premium or the app stops working. Playback control requires Premium for the user too. |
| Five authorized users | One Development Mode Client ID per developer, capped at five allowlisted users. Each added manually by email in the dashboard. |
| No extended quota | Since May 15 2025, Spotify only accepts extended quota applications from organizations, not individuals. Criteria include a registered business and 250,000 MAU. This path is closed. |
| No audio analysis | `audio-features` and `audio-analysis` return 403 for apps created after Nov 27 2024. No BPM, no beat grid. Groove visuals are decorative. |
| Spotify must be running | It is the playback device. `GET /me/player` returns HTTP 204 with an empty body when there is no active device. |
| Internet required | Both apps are on the same machine but never talk directly. Every command round-trips through Spotify's servers. |

**Endpoints that survived the February 2026 cull and that Vuelta depends on:**
`GET /me/player`, `GET /me/player/devices`, `GET /me/player/queue`, `PUT /me/player/play`, `PUT /me/player/pause`, `PUT /me/player/seek`, `PUT /me/player/volume`, `POST /me/player/next`, `POST /me/player/previous`, `PUT /me/player` (transfer).

---

## 3. Distribution model

Because of the five-user cap, Vuelta ships **open source with a bring-your-own Client ID model**.

Each user registers their own Spotify app in the developer dashboard, allowlists themselves as its single user, and pastes the resulting Client ID into Vuelta on first run. Every install is its own Development Mode app with one authorized user, so the cap never binds and an unlimited number of people can run Vuelta entirely within Spotify's rules.

**Consequences for the build:**

- Client ID is a first-run setting stored in config, not a compile-time constant. Cheap now, painful to retrofit.
- The redirect URI must be a **fixed port**, since Spotify requires an exact match. Use `http://127.0.0.1:8888/callback`. Display it on the setup screen with a copy button so users paste the exact string. Handle the port-in-use case by offering a fallback port and telling the user to add it to their dashboard too.
- A 403 response means the user has not allowlisted themselves. This will be the most common support issue. Catch it specifically and show instructions, not a raw error.
- Users need Premium. Say so on the setup screen, not in the README only.
- Windows SmartScreen will flag an unsigned installer. Document the "More info → Run anyway" click. Code signing certificates cost hundreds per year and are not worth it here.
- License MIT or Apache 2.0. Do not put "Spotify" in the app name. Follow Spotify's design guidelines for attribution.

---

## 4. Authentication

**Flow:** Authorization Code with PKCE. No client secret — a desktop binary cannot keep one.

**Scopes:** `user-read-playback-state`, `user-modify-playback-state`, `user-read-currently-playing`

**Steps:**

1. Generate a random code verifier and a random `state` value. Keep both in memory.
2. SHA-256 the verifier to produce the code challenge.
3. Open Spotify's authorize URL in the **system browser** with the challenge, state, Client ID, scopes, and redirect URI.
4. Start a local HTTP listener on `127.0.0.1:8888`.
5. User logs in on Spotify's own domain and approves. Vuelta never sees the password and must never show its own Spotify login form.
6. Spotify redirects back with a one-time code. Validate `state` matches.
7. Exchange code plus verifier for an access token (≈1 hour) and a refresh token (long-lived).
8. Shut down the listener.
9. Store the refresh token via Electron `safeStorage`, backed by Windows Credential Manager. Never a plaintext JSON file. The Client ID is not secret and can live in plain config.
10. Refresh silently on expiry so the user never logs in again.

**Why PKCE matters here specifically:** the redirect goes to loopback, where another local process could in principle race to grab the code. The verifier never leaves Vuelta's memory, so an intercepted code is useless.

**Why users can't be mixed up:** the token *is* the identity. Vuelta never sends a username. Spotify resolves "me" from the token server-side on every request. Each install holds exactly one token on one machine, so unlike a web app there is no central store that could map the wrong session to the wrong account.

---

## 5. Architecture

Four layers. Each talks only to its neighbours.

```
┌──────────────────────────────────────────┐
│ Skin layer                               │
│ top view · console view · future 3D skin │
└──────────────────────────────────────────┘
                    ↕  RenderState + Actions
┌──────────────────────────────────────────┐
│ Core logic                               │
│ store · clock · reconciler · arm math    │
└──────────────────────────────────────────┘
                    ↕  IPC
┌──────────────────────────────────────────┐
│ Electron main process                    │
│ PKCE auth · token storage · API client   │
└──────────────────────────────────────────┘
                    ↕  HTTPS
┌──────────────────────────────────────────┐
│ Spotify Web API                          │
└──────────────────────────────────────────┘
```

**The governing principle:** the thing that knows about Spotify and the thing that draws a turntable must never know about each other. Skins receive only `RenderState` and `Actions`. No fetch calls, no tokens, no awareness that Spotify exists. This is what makes a photoreal renderer a swap rather than a rewrite.

**Test for whether the boundary is real:** `core/` must run in a plain Vitest file with no DOM and no React imports.

---

## 6. The contract

```ts
type RenderState = {
  progressMs: number
  durationMs: number
  isPlaying: boolean
  albumArtUrl: string | null
  nextAlbumArtUrl: string | null
  armAngle: number          // degrees
  isDragging: boolean
  lidOpen: boolean
  platterRpm: number        // for spin-up / spin-down easing
  transitionPhase: 'idle' | 'lifting' | 'swapping' | 'dropping'
  view: 'top' | 'console'
}

type Actions = {
  play(): void
  pause(): void
  seek(ms: number): void
  next(): void
  previous(): void
  setVolume(percent: number): void
}
```

---

## 7. State machine

```
IDLE ──click lid──> CONNECTING ──ok──> NO_DEVICE ──device found──> PLAYING ⇄ PAUSED
                         │                  ▲                          │
                         └──auth fail───────┴──────device lost─────────┘
```

- **SETUP** — first run only. Client ID entry, redirect URI display, link to the dashboard.
- **IDLE** — lid closed, dust cover down. The whole player is one click target.
- **CONNECTING** — OAuth in progress, or hunting for an active device.
- **NO_DEVICE** — authorized but Spotify isn't running or isn't active. Needs a designed screen, not an error toast; this happens constantly. Suggested copy: *"No turntable connected. Open Spotify and press play."*
- **PLAYING / PAUSED** — the main loop.

Opening the lid issues `PUT /me/player/play` with no body, which resumes the user's last context. This is how playback starts without Vuelta needing a library browser.

---

## 8. Playback sync

The most important engineering detail in the app.

- Poll `GET /me/player` every **3–5 seconds**. Never every second; rate limits use a rolling 30-second window.
- Between polls, advance `progressMs` locally on `requestAnimationFrame`.
- On each poll, reconcile: if local drift exceeds ~500ms, **ease toward truth rather than snapping**.
- Poll more slowly (~10s) while paused.
- Handle 429 with `Retry-After` and back off.

### One module owns time

Three things want to write `progressMs`: the poll response, the local clock, and the user dragging the arm. If all three write to it, the arm jitters and fights the user. One module owns the value. The clock advances it, the reconciler nudges it, and dragging suspends both until release.

### Optimistic override with an expiry

The bug that would otherwise cost you a weekend. Press next, the UI updates instantly, then a poll already in flight arrives carrying the *old* track and the UI snaps backwards before jumping forwards again.

Fix: every user action writes an optimistic override stamped with a timestamp and a ~5 second TTL. While the override is alive, contradicting poll data is discarded. Once the server agrees or the timer expires, the override dies.

Applies to: play, pause, next, previous, seek, volume.

---

## 9. The record model

**One track = one record.** The center label is that track's album art. The arm sweep maps to that one track's duration.

Rejected alternatives: one album per record with A/B sides (too restrictive, most listening is playlists), one playlist as a side (arm becomes uselessly imprecise, no single correct label image).

**Music source: mirror only.** Vuelta shows whatever Spotify is already playing. No library browser, no search, no playlist UI. This cuts roughly 70% of the scope.

---

## 10. Tonearm

**Geometry:**

- `REST_ANGLE` = −12° (in the cradle, off the record)
- `START_ANGLE` = 0° (outer groove, position 0)
- `END_ANGLE` = 22° (inner groove, track end)

```
armAngle = START + (progressMs / durationMs) × (END − START)
```

**Precision problem:** 22° across a 3:30 track is ~9.5 seconds per degree. Realistic mouse precision is about half a degree, giving ±5 seconds. Mitigations:

- Floating timestamp readout beside the needle while dragging (`1:47`)
- Hold `Shift` to slow the angle-to-time mapping for fine control
- **Commit `seek` on drag release only.** Never fire continuously during the drag.

**Platter:** spins down with easing on pause, spins up on resume. Never an instant stop.

---

## 11. Interactions

| Target | Action | Result |
|---|---|---|
| Disc | Click | Toggle play / pause |
| Tonearm | Drag | Scrub, commits `seek` on release |
| Lid | Click | Open at launch, close to return to IDLE |
| Volume knob | Vertical drag or scroll wheel | `PUT /me/player/volume` |
| Prev / Next | Click | Skip |

**The disc is the play/pause target, not the arm.** The arm is thin and moving, which makes it a poor click target. The arm still animates to rest on pause, so nothing is lost visually.

**Pause behaviour:** arm returns to `REST_ANGLE`. Resume animates it back to the stored angle before playback restarts.

**Open problem this creates:** while paused, the arm is off the record, so there is no position indicator and nothing to drag. Proposed fix: a faint marker stays on the disc at the paused position, and dragging *that* scrubs while paused.

**No stop button.** Spotify has no stop endpoint, and pause already lifts the arm to rest. A stop that also reset position would be a destructive control sitting beside play. Three buttons only: previous, play/pause, next.

**Knob interaction:** vertical drag plus scroll wheel, not circular drag. Circular dragging on screen is fiddly. The knob still *rotates* visually.

---

## 12. The two views

**View A — Top-down.** Camera overhead. Disc and tonearm fill the window. Nothing else.

**View B — Console.** Split layout. Left: front elevation of the player with speaker grille, power LED, volume knob, and three transport buttons. Right: disc and tonearm top view. The disc and arm behave exactly as in View A.

**Switching:** a subtle corner toggle that fades in on hover, plus a keyboard shortcut. Any always-visible chrome fights the illusion.

---

## 13. Track transitions

Full record-swap animation, **anticipated rather than reactive**.

The trap: polling is 3–5 seconds behind, so by the time a poll reports a track change the new song is already well underway. A swap animation starting then lands absurdly late.

**The sequence:**

1. On track start, call `GET /me/player/queue` and cache `nextAlbumArtUrl`.
2. When the local clock reads `durationMs − progressMs ≈ 2000ms`, begin the arm lift.
3. Play the swap across the actual boundary so the new label settles as the first bar hits.
4. If the user skips manually in Spotify, the next poll surprises us — snap without animation and accept it.

**Budget: 2–3 seconds total.** Longer and skipping through tracks becomes painful.

---

## 14. Tech stack

**Decision: Electron + TypeScript.** Tauri was considered and rejected.

| Layer | Choice | Why |
|---|---|---|
| Shell | Electron | No new language; the project's real difficulty is animation, not the backend |
| Main process | TypeScript | Holds the token, runs the loopback listener, owns all HTTP |
| OAuth listener | Node built-in `http` | ~10 lines, fixed port 8888 |
| Token storage | Electron `safeStorage` | Backed by Windows Credential Manager |
| Frontend | React + TypeScript + Vite | Fast HMR |
| State | Zustand (vanilla store) | Works outside React, so `core/` stays React-free |
| Skin rendering | DOM + CSS transforms, SVG for grooves | GPU-accelerated; no canvas needed |
| Sequenced animation | Motion (Framer Motion) or GSAP | Lid and record swap only |
| Continuous animation | Hand-written `requestAnimationFrame` | Arm and platter |
| Tests | Vitest on `core/` | No DOM, trivially testable |
| Packaging | electron-builder → NSIS | |

**Why Electron over Tauri.** Tauri gives a ~5MB binary versus ~120MB and roughly half the idle RAM. Both real benefits. But Tauri's backend is Rust, and this app makes about one HTTP request every four seconds — it needs nothing Rust is good at. For a solo developer whose actual challenge is a convincing tonearm and a beautiful lid animation, adding a language adds risk to the one part of the project that currently has none. Personal projects die from friction, not technical debt.

**The port is cheap if it ever matters.** The entire frontend moves across untouched; only auth, token storage, and window setup change. That's a weekend.

### Two rules that will not bend

**Never animate through React state.** If `armAngle` lives in `useState` and updates each frame, React re-renders the whole turntable 60 times a second and the app stutters. Core owns the number and notifies subscribers imperatively; the skin writes `transform` directly via a ref. React renders structure once, then gets out of the way.

**Two animation strategies, not one.** Arm and platter are continuous, driven by an always-changing value → hand-written rAF. Lid and record swap are discrete sequences with a start and end → timeline library. Forcing both through one tool means fighting the library.

**Styling:** hand-written CSS for the skin, since it's all custom transforms, gradients, and shadows that utility classes fight. Use whatever's fastest for plain screens like SETUP and NO_DEVICE.

---

## 15. Folder structure

```
src/main/          auth, token storage, spotify client, IPC handlers
src/core/          store, clock, reconciler, transition, armMath   ← no React
src/skins/2d/      disc, tonearm, lid, knob, buttons
src/views/         TopView, ConsoleView
src/app/           state machine, SETUP screen, NO_DEVICE screen
```

`core/` must not import from `skins/` or from React.

---

## 16. Build order

**M = milestone.** The numbering starts at zero because M0 produces nothing visible. Each milestone is defined by what you can *see* when it's finished, not by which files exist.

Auth first, before a single pixel of turntable. It is the only part of this project that can fail in a way you cannot design around.

| Milestone | Deliverable |
|---|---|
| **M0** | Electron shell, PKCE auth, Client ID setup screen. Current track printed as plain text. No graphics at all. |
| **M1** | State layer: polling, local extrapolation, reconciliation, optimistic overrides. Rendered as an ugly HTML progress bar. |
| **M2** | 2D skin: disc, center label, tonearm, spin. Read-only. |
| **M3** | Interactions: disc click to play/pause, arm drag to seek. |
| **M4** | Lid and the opening sequence. |
| **M5** | Console view, three buttons, volume knob. |
| **M6** | Record-swap animation with queue pre-fetch. |
| **M7** | Polish: tray, always-on-top, frameless chrome, NO_DEVICE screen, packaging. |

**The split at M1 is deliberate.** Everything up to there is plumbing with real unknowns. Everything after is drawing and animating, where nothing can surprise you — only take time.

---

## 17. Design work

**Do not design before M0.** Design work is pleasant, which makes it an effective way to avoid the part of the project that can actually fail. Beautiful mockups for an app that cannot authenticate are worth nothing.

**Do design before M2.** Drawing a record player with no target in front of you means nudging a disc around for three days.

What's actually needed — smaller than a design system:

- One static mockup of the top view at real size, disc, label, and arm in correct proportion
- One of the console view, showing how the front panel and disc sit together
- A palette: wood tone, vinyl black, panel finish, accent
- **A decision about the background.** Does the player float on a transparent or dark field, or sit on a desk surface? Still undecided, and it sets the whole mood.
- Geometry on paper: disc diameter relative to window, arm pivot point, and the angles from §10. Both the mockup and the code should use the same numbers.

**Most of this app's design is motion** — the arm's ease into the groove, the platter's spin-up, the lid's weight. None of that can be mocked statically. Lock proportion and colour in a static tool, then design the motion in code where you can feel it.

---

## 18. Known risks

- **Album art cropping.** Spotify's design guidelines restrict altering album art, and fitting a square cover into a circular label is a center crop. Fine for personal use; read the guidelines before any public release.
- **API churn.** Spotify has changed developer terms repeatedly in under two years. Keep every API call behind one module so a future migration touches one file.
- **Photoreal is an art problem, not a code problem.** Blender renders or a Three.js scene are weeks of work by someone who does 3D. The 2D version must be able to ship on its own.
- **Onboarding friction.** The bring-your-own-Client-ID flow filters out casual users. Accept it; the audience for a virtual turntable will do it.

---

## 19. Still open

1. Background treatment for the player — transparent, dark field, or desk surface?
2. The paused-position marker on the disc: elegant, or clutter?
3. Auto-launching the Spotify client via the `spotify:` URI scheme when no device is found, as an M7 stretch goal. Needs a polling loop with a timeout and a graceful fall back to NO_DEVICE.
4. Whether the SETUP flow gets its own milestone or folds into M0.
