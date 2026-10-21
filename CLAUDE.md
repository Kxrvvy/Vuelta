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

- **One track = one record.** In the machine looks the centre label is that track's album art. In the flat-lay it is a **printed record label** — title, artist, hairline ring, catalogue number, punched spindle hole — and it counter-rotates so the text stays upright. The album art is on the **sleeve** there, once, never twice in one frame.
- Arm sweep: `REST_ANGLE` −12°, `START_ANGLE` 0°, `END_ANGLE` 22°.
- **The park is a pose, not an angle.** The flat-lay parks the arm vertically, clear of the disc, by drawing any `armAngle` at or below `START_ANGLE` as that pose and easing between. `REST_ANGLE` keeps its meaning in core and is never re-tuned per skin.
- **The flat-lay's arm geometry is solved** (`skins/flatlay/geometry.ts`), because placing it by eye does not close: a pivot far enough out to look right cannot reach the inner groove, and forcing it needs an arm half the width of the window. `solveArm` bisects for the one pivot distance that puts `armAngle` 0 on the outer groove and 22 on the inner.
- **Disc click** = play/pause. **Arm** = drag only.
- **Pause parks the arm.** Pause lifts the stylus a few millimetres *and* returns the arm to its rest position — the cradle in the machine looks, the vertical park in the flat-lay. The platter still spins down. This reverses the earlier cue-lever rule, where the arm hovered at its current angle: a paused turntable that has visibly stopped reads better than one frozen mid-sweep, and the rest position is the only part of the travel that says "not playing" on its own.
- The arm **stays draggable while paused** and seek still commits on release; it simply returns to rest afterwards, because it is still paused. A drag outranks the park — `armAngleNow` in `core/armMath.ts` is the one place that ordering lives, and it is the same in every look.
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

Switched from the browser bar or with keys 1/2/3. Session-only; starts on **Main**.

| | |
|---|---|
| **Main** | The whole machine, centred, now-playing panel at the right. The original view. |
| **Lyrics** | Machine left, a column of synced lyrics at the side **in place of** the panel. |
| **Close-up** | A sleeve and a record lying on a sheet of paper, seen from overhead, with a tonearm. **No machine at all** — not even a picture of one. |

- The lyrics column is **content, not chrome**: it does not fade with the click gesture, and it
  reserves the right edge so the camera frames the machine beside it.
- **The close-up is a different skin, not a second camera.** `skins/flatlay/` draws it in DOM and
  SVG; `skins/3d/` draws the other two in one `<Canvas>` with one camera. The flat-lay scene is
  flat and lit, every value in its spec is a CSS value, and nothing in it is a three.js object.
  Keeping it in the canvas is what forced the layer system, a scissored second viewport and a
  reserved band in the camera fit; all of that is deleted.
- **Switching to it hides the canvas, it does not unmount it.** Tearing the `<Canvas>` down throws
  away the generated environment map and every texture and rebuilds both on the way back, so
  `Stage` sets `display: none` on `.stage__machine` instead.
- **The flat-lay is laid out in a fixed 1280×800 design box**, scaled to the window by one
  `transform`. That is what lets the spec's pixel values — shadow offsets, hairlines, the groove
  period — be taken literally. Nothing reflows; the composition is one shape at one aspect.
- **The record is 5% smaller than its sleeve** (`RECORD_SCALE`), as a 302mm LP is to a 315mm
  jacket. Flush with it, the disc does not look like it could go back in. The label, hole and lands
  scale with it.
- **Vinyl is drawn as reflection, not colour**: a dark base, two specular arcs set ~90° off the
  lamp rather than toward it — a groove is a circular grating — smooth lands glossier than the
  grooved band, and a rolled edge. The arcs are static; the disc turns under them.
- **The groove rings are meant to be seen.** `GROOVE_PERIOD` is the one authority and the skin
  hands it to CSS. The design's ~2px at nine levels of contrast was invisible; what fixed it was
  mostly contrast, and the wider period keeps the spacing even rather than beating against the
  pixel grid once the box is scaled.
- **The sleeve overlaps the record and occludes it.** 35% of the disc is tucked behind the jacket
  at rest, and `TUCK_FRACTION` is the one number the whole layout and §9's slide derive from. This
  replaces the earlier rule that the two never overlap, which belonged to the 3D close-up, where
  whichever card sat behind had a bite taken out of it by the other. In DOM, paint order settles it
  and nothing is lost.
- **Clicking the cover trades it with the record in the stack.** Positions are identical before and
  after; only which one is on top changes. The move is the three ordered phases of
  `core/cardSwap.ts` — apart, flip, home — and the flip happens during the hold, where the two are
  clear of each other, so it is never seen as a pop inside the overlap band.
- **Only the cover moves.** It slides clear, trades places with the record out there where nothing
  overlaps, and slides home; the record does not stir, so the arm has nothing to follow and the
  stylus never leaves the groove it is playing. Both used to move, because with the sleeve at the
  frame's left edge there was less room beside it than the 154px overlap was wide — centring the
  arrangement gave the cover room to do the whole move itself.
- **The arrangement is centred by derivation, not by eye** — `SLEEVE_LEFT` solves for it from the
  composition's width. The arm reaches well past the record, so the bearing circle is the
  right-hand edge and the thing is much wider than the two cards suggest; centring on the cards
  left a third of the frame empty.
- **The cover lies askew when it is behind**, tilted four degrees anticlockwise so its upper right
  corner rides higher than its upper left. Only the back of the stack gets it; the front sits
  square. The tilt eases on with the depth rather than snapping once the move lands.
- **The arm sits above both cards** (`z-index: 4`). The card move raises the record to 2, and
  without it the record paints over the arm for as long as the cover is behind.
- The disc stays the play/pause target, so the two gestures never collide, and the card move is
  purely visual — playback is untouched.
- **One bar for all three looks.** The flat-lay uses the same `BrowserBar` as the machine looks,
  summoned and dismissed by the same click on the empty field. It had a transport pill of its own
  for a while, with a gear and a `···` view switcher in the corners; two pieces of chrome doing one
  job is one too many, and the pill is gone.
- **Everything lying on the paper absorbs its own click** — the disc, the cover and the arm.
  Without that the click reaches the field underneath and toggles the chrome too, so play/pause
  would summon or dismiss the bar every time.
- **The top of the arm is the play/pause control**, and there is no cue button. The gesture belongs
  on the arm, where a cue lever is. The housing takes the click; the tube below it is the drag
  handle, and the two targets are kept apart so they cannot fight.
- **Putting the needle down starts the record.** A drag that ends on the groove commits its seek
  and then plays, the way it does on a real deck — which is also what stops a scrub-while-paused
  from sending the arm straight back to its park the moment you let go.
- **The flat-lay still needs the lid open**, like the close-up before it. A closed lid is the front
  pose in every look, which is what keeps "closing the lid is the stop gesture" true here too.

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
