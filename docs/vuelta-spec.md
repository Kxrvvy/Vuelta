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

Added with the browser bar: `GET /me/playlists`, `GET /playlists/{id}/tracks`, `POST /me/player/queue`, and `PUT /me/player/play` with a `context_uri` body (the bodiless form still resumes, and is what the disc click sends). The two playlist reads need `playlist-read-private` and `playlist-read-collaborative`; the queue needs no scope beyond those already held.

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

**Opening the lid plays nothing.** It is a mechanical act: the lid rises, the camera moves to the overhead view, and the machine waits. On a real deck a lid does not start a record — you drop the needle — and the same should be true here.

Playback starts when the **disc** is clicked, which issues `PUT /me/player/play` with no body and so resumes the user's last context. The point this section was originally making survives intact: playback still begins without Vuelta needing a library browser. It is simply the disc that does it, not the lid.

Closing the lid remains the stop gesture (§11): it pauses, and pause returns the arm to the cradle. The asymmetry is deliberate.

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

**One track = one record.** The arm sweep maps to that one track's duration.

**The centre label is a printed record label, not the album art.** Title, artist, a hairline ring, a catalogue number and a punched spindle hole; it counter-rotates so the text stays upright while the disc turns.

This replaces the original rule, which put the album art in the label. The art now lives on the **sleeve** in the flat-lay (§12), where it is large and legible. Duplicating it inside a 165px circle made the scene read as a media player rather than as two objects on a desk, and it meant the same image appeared twice in one frame. In the machine looks, which have no sleeve, the label keeps the art.

Rejected alternatives: one album per record with A/B sides (too restrictive, most listening is playlists), one playlist as a side (arm becomes uselessly imprecise, no single correct label image).

**Music source: mirror, plus a chooser.** Vuelta shows whatever Spotify is already playing, and the browser bar (§11) lets you pick a playlist or look at the queue. Nothing more: no search, no album or artist views, no editing, no library browser.

This supersedes the original rule, which was "mirror only — no library browser, no search, no playlist UI", credited with cutting roughly 70% of the scope. Most of that saving survives: what came back is two read endpoints and a list, not a second Spotify client. The line now sits at *choosing a record*, and the reason it sits there is the same as before — everything past it is a music browser, and Spotify already ships one.

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

**Rest position.** In the machine looks the arm rests in its cradle at `REST_ANGLE`. In the flat-lay it parks **vertically, straight down from the pivot and entirely clear of the disc**.

The park is a *pose*, not a bearing on the groove band. The skin draws any `armAngle` at or below `START_ANGLE` as the park and eases between the two, which is what lets `REST_ANGLE` keep meaning "parked" in core without being re-tuned per skin.

**The flat-lay's arm geometry is solved, not placed.** Given the stylus reach, the outer and inner groove radii and the 22° sweep, there is exactly one pivot distance that lands `armAngle` 0 on the outer groove and 22 on the inner; `solveArm` in `skins/flatlay/geometry.ts` bisects for it. It has to be solved because the obvious placement does not work: a pivot far enough out to look right leaves the stylus unable to reach the inner groove at all, and forcing it demands an arm half the width of the window. The solved pivot sits about 1.36× the disc radius from the spindle, which is close to a real 12" deck's 1.38.

**Platter:** spins down with easing on pause, spins up on resume. Never an instant stop.

---

## 11. Interactions

| Target | Action | Result |
|---|---|---|
| Disc | Click | Toggle play / pause |
| Tonearm | Drag | Scrub, commits `seek` on release |
| Lid | Click | Open to start; close to stop and return to IDLE |
| Volume knob | Click and hold, slide horizontally | `PUT /me/player/volume` |
| Prev / Next | Click, in the side panel | Skip |
| Playlists / Queue | Click, in the browser bar | Open the matching pane |
| Playlist row | Click | Open it; the ▶ button plays it |
| Track row | Click | Play it in place; ⊕ adds it to the queue |

**The disc is the play/pause target, not the arm.** The arm is thin and moving, which makes it a poor click target.

### Pause parks the arm

Pause lifts the stylus a few millimetres **and returns the arm to its rest position** — the cradle in the machine looks, the vertical park in the flat-lay. The platter still spins down with easing, so the two read as one gesture: the arm lifts, and then it travels home while the disc winds down.

This reverses the cue-lever rule that stood here before, which left the arm **hovering at its current angle** on the grounds that this is what a real turntable's cue lever does. It is, and it was still the wrong call. A paused turntable that has visibly *stopped* is legible at a glance; one frozen mid-sweep is not, because the arm's angle means position, not state, and nothing else in the frame distinguishes "paused here" from "playing here" except a shadow and three millimetres of lift. The rest position is the only part of the arm's travel that says *not playing* on its own.

What the old rule was protecting is kept anyway: **the arm stays draggable while paused**, and `seek` still commits on release exactly as when playing. A drag outranks the park, so the arm follows your hand the moment you take hold of it, and returns to rest when you let go — because it is still paused. One function, `armAngleNow` in `core/armMath.ts`, holds that ordering for every look, and it is stepped in a test rather than inferred from the state layer.

The lifted state has to be legible or pause looks like nothing happened. Three cues carry it: a slightly larger and softer drop shadow, a small vertical offset, and the needle visibly clear of the groove.

### The lid is the stop gesture

**There is no stop button.** Spotify has no stop endpoint, and a stop control that also reset position would be a destructive button sitting next to play.

Closing the lid is what stops playback. It pauses — and pause is now what returns the arm to `REST_ANGLE`, so the lid no longer owns that on its own. What the lid still owns is the *session*: it is the gesture that says you are finished, and it is the only one that also shuts the machine.

Opening is *not* the symmetric act. The lid rises and nothing plays (§7) — starting the record is the disc's job. A lid that started music the moment it opened would take the decision away from you; a lid shut over a spinning record plainly ends the session.

### Knob interaction

Click and hold the knob, then slide **horizontally**. Not vertical, and not circular — circular dragging on screen is fiddly, and horizontal reads as a natural volume axis. The knob still *rotates* visually as it tracks.

The scroll wheel also works, but only while the pointer is over the knob. Scroll anywhere else does nothing, so a stray wheel event over the record cannot silently change playback volume.

The knob exists in two places at once: as geometry on the cabinet, and mirrored in the side panel. Both drive the same value and both rotate together. The cabinet knob is the honest one; the panel copy exists because at the top-down camera angle the real knob is a small target.

### The browser bar

A thin strip of chrome at the bottom centre with two buttons, **Playlists** and **Queue**, and a
sheet that rises from it when a pane is open. Clicking the lit button again dismisses it, as does
Escape. It is present only while the lid is open — the closed-lid front view stays bare.

Playlists list name, cover and track count. Clicking a row opens it; a separate ▶ plays it. Inside
a playlist, clicking a track plays the playlist *from that track* (one `play` call with a
`context_uri` and an `offset`), and ⊕ adds it to the queue. The queue pane lists what is coming up.

**Jumping within the queue is one call, not many.** The first upcoming item is a plain `next`.
Beyond that, the only single-call route is a context offset, which works for items that came from
the playlist — nearly all of them — and is refused for one queued by hand. That refusal surfaces as
an inline message, in preference to firing `next` repeatedly against the rate limit.

The bar is summoned and dismissed with the side panel, by the gesture below. Unlike the panel, **the camera
makes no allowance for it**: the bar sits inside the margin that exact vertical centring already
leaves beneath the machine, which at the 520px minimum window height is about 68px against the
bar's 52px footprint. The sheet is an overlay and may cover the machine, because reserving room for
a list that tall would shrink the turntable to nothing.

Two alternatives were built and removed. Shrinking the machine to fit above the bar made it 12%
smaller for a 38px strip. Shifting the look-at up instead keeps the size nominally fixed but moves
the camera nearer, which made the machine grow about 6% every time the bar faded in or out —
breathing every time the chrome came or went, which is worse than either. What the bar costs is therefore a constraint
on `FILL_V` rather than anything dynamic: the bar must fit the margin, and a test holds that.

### The deck counter

A small amber seven-segment panel set into the deck at its front-right corner,
reading elapsed and total time over a thin progress track. It is **part of the
machine, not chrome over it** — the side panel and the needle readout already
show the same number, but both float above the scene.

It is not interactive. The bar reports position, it does not set it; dragging
the arm is the seek gesture and a second one would compete with it.

The colon blinks once a second while paused, which is what distinguishes
paused from stopped once the platter has spun down. **Closing the lid puts the
counter out**, consistent with the lid being the stop gesture — the machine
reads as powered down rather than merely quiet.

Front-right reads as lower-right on screen, since the overhead camera looks
down the -z axis. The front face could not take it — the grille leaves 25mm
beside it and 17mm beneath — and of the two deck corners the right has far
more room: 161mm of clear deck against 58mm, because the platter well cuts the
left wedge down while the right opens out toward the arm pivot.

Three clearances hold it, and all three are pinned by tests because every one
of them is set in a different file: 4mm from the deck border, 71mm from the
tonearm at its furthest-forward reach (the stylus parked at `REST_ANGLE`), and
74mm from the platter well.

### The side panel

Transport and now-playing live in a panel at the right edge: album art, title, artist, elapsed and total, previous / play-pause / next, and the mirrored volume knob.

It is an overlay rather than a column, so the turntable never shifts position when it appears. This keeps §13's rule — any always-visible chrome fights the illusion — while still giving skip a home, since skipping a track has no natural gesture on a turntable.

**The chrome is summoned by a click, not by hover.** A click that lands on the empty field around the machine raises the panel and the browser bar together; another one there, or Escape, dismisses them, closing an open sheet in the same gesture. Pointer movement does nothing. The machine absorbs its own clicks — the disc, arm, knob, lid and Open button act, and the wooden body, the deck and the counter panel do nothing at all — so play/pause never disturbs the chrome and the wood is not a way to summon it.

This replaces an earlier rule where both faded in on pointer activity and out after a few seconds of stillness. Merely crossing the window summoned them, which made the chrome always-visible in practice and so broke the very rule it was written to keep; and a timer dismissed them rather than the user. The cost is discoverability, since nothing advertises a gesture on empty space: the chrome therefore starts shown each time the lid opens, and teaches itself by being clicked away.


## 12. The three looks

The machine wears one of three compositions, switched from three labels in the browser bar or with
the keys **1**, **2** and **3**. The choice lasts the session and starts on Main every launch.

**1 — Main.** Camera overhead, the whole machine centred, the now-playing panel down the right. The
original View A, unchanged, and the default.

**2 — Lyrics.** The machine to the left, a column of time-synced lyrics beside it. The column takes
the right edge *in place of* the panel and keeps a compact title and prev/play/next at its foot,
because skip has no gesture on a turntable. It reserves its width the same way the panel does, so
the camera frames the machine into what is left rather than behind it. Unlike the panel it does not
fade with the click gesture: it is the content of that view, not chrome over it.

**3 — Close-up.** A flat-lay, from directly overhead: an album sleeve and a record lying on a sheet
of warm paper, with a tonearm across the record, and **no turntable in the view at all** — not even
a picture of one. The record is half pulled out of its jacket, and exactly half: the sleeve covers
50% of the disc, which is the signature of the layout and the one measurement everything else
derives from — the cover's travel during a swap included. At a half the record's centre, and so the
spindle, sits precisely on the sleeve's right edge.

**The same half stays covered whichever card is on top.** Neither object moves when they trade
places, so front and back differ only in stacking. What that costs is the label: with the cover in
front its left half is behind the jacket, so the title and artist read fully only once the record
comes forward. It was 35% before, where a sliver of the label was clipped rather than half of it.

**It is a second skin, not a second camera.** `skins/flatlay/` draws it in DOM and SVG;
`skins/3d/` keeps the other two looks. That is a reversal: it began as one scene rendered through
two cameras into two scissored regions of a single canvas, with the machine surviving as a small
inset at the top left.

What that cost is worth recording, because it is why the scene left the canvas. A part could not be
hidden from one camera by unmounting it, so there were three layers and an `OnLayer` that traversed
on every commit. The raycaster had to be pinned to the main camera's mask or the lid and the Open
button became unpickable everywhere. The inset needed a reserved band along the top of the camera
fit, because clearing its rectangle while the composition ran underneath cut a notch out of the
artwork, while not clearing it let the machine paint over the artwork and the artwork slide about
behind the machine — each shipped once. The band had to move the look-at along **z** rather than y,
since at 86 degrees `cos` is 0.07 and making room upward sent the solver three quarters of a metre
into the air. And handing any `useFrame` a priority stopped R3F rendering by itself, so the
viewport module drew every frame in every look.

None of that exists now. The scene the spec describes is flat, lit and specified entirely in CSS
values — px shadow offsets, 1px hairlines, a groove period — so drawing it in DOM is both more
faithful and very much smaller. Switching to it hides the canvas rather than unmounting it, so the
generated environment map and the textures survive the round trip.

**It is laid out in a fixed 1280×800 design box**, scaled to the window by one uniform transform.
Nothing reflows and nothing is stretched, which is what lets every pixel value in the design hold
exactly and keeps the record a circle at any window size.

**Centred by derivation.** The sleeve's left edge is solved for, not chosen: the arrangement's
width is fixed by the tuck and the arm's reach, and the left edge is whatever puts that width in
the middle of the box. It needs solving because the arm reaches a long way past the record — the
outside of the bearing circle is the right-hand edge, not the record's rim — so an arrangement
centred on the two cards by eye sits well to the left, with about a third of the frame empty
beside it. That is exactly what it did at first.

**The scene.** A flat bone-white field, `#EEEAE7`, with a generated grain at about 3% and a very
soft vignette; the sleeve with its art bleeding to all four edges, a 2px corner radius, a
directional shadow from the upper left and a tight contact shadow so it sits *on* the paper; the
disc, which has its own section below. Nothing in the scene is pure black.

**The record is 5% smaller than its sleeve**, the way a 302mm LP is smaller than its 315mm jacket.
They were exactly the same size at first, and that is the one proportion that gives the trick away:
a disc flush with its jacket does not look like it could ever go back in. The whole record scales
with it — label, spindle hole and the two smooth lands — so the proportions it was drawn with
survive.

**The vinyl.** `#42413C` was the colour the design called for and it read as dark plastic, because
almost everything you see on a record is reflection rather than colour. What it takes:

- A much darker base, `#26252b`. Still not black.
- **Groove rings you can actually see.** The design asked for a ~2px period at very low contrast —
  "felt, not counted" — and what that produced could not be made out at all. Measured against the
  real stylesheet, the cause was mostly contrast: nine levels off the base is a grey wash at this
  size. Spacing mattered too, but differently than it looked: at 2px, with the box scaled to the
  window, the bands land sub-pixel and beat against the grid, so the rings resolve in uneven
  merged runs. A wider period keeps them regular. A real LP's grooves are finer than either
  figure and finer than a screen can draw — past a point, accuracy is just grey.
- **Two specular arcs, and not pointed at the lamp.** Grooves are a circular diffraction grating,
  so the highlight does not sit where the light comes from — it forms two arcs about 90° either
  side of it. With the lamp at the upper left the arcs fall upper-right and lower-left. Aiming one
  at the lamp instead puts it behind the sleeve, which covers the disc's upper left; the first
  attempt here did exactly that, and the highlight was invisible until the pixels were read back.
- **Smooth lands that are glossier than the grooves.** The lead-in at the rim and the run-out by
  the label have nothing to scatter the light, so they come back a shade lighter.
- **A rolled edge.** A record's rim is rounded, not a cut cylinder: a hairline catches the light
  just inside it and the last pixel or two falls away dark.

The arcs are static. The disc turns under them, which is what a real record does — the groove
pattern is rotationally symmetric, so the highlight belongs to the lamp and not to the record.

**The arm.** Slim and machined rather than a bar: a hairline bearing circle, a white pivot housing,
a counterweight behind it, a brushed aluminium tube with a gradient across its width, and a
headshell angled 20° off the tube axis with the stylus at its tip. The bend is in the geometry as
well as the drawing — a headshell rotated only for looks puts its tip 16px off the arm's axis,
which at this scale is most of the run-out band.

**The arm is the transport.** Its top — the housing and counterweight — is the play/pause control,
and there is no separate cue button; one sat beside the bearing for a while and the gesture belongs
on the arm, which is where a cue lever is. The tube below it is the drag handle, and the two
targets start clear of one another so a grab never lands on the button or the other way round.

**Putting the needle down starts the record.** A drag that ends on the groove commits its seek and
then plays. That is what a real deck does, and it also settles something pause introduced: with the
arm parking on pause, a scrub while paused used to end with the arm travelling straight back to its
rest position the moment you let go. Now it stays where you put it, and the record starts.

**The cover is square on both sides of the stack.** It lay askew at the back for a while — four
degrees anticlockwise, a sleeve pushed under something and left where it fell — and went back to
square: with half the disc covering it, front and behind are better told apart by the stacking
alone than by a tilt that only the uncovered half shows.

**Clicking the cover sends it behind the record, or brings it back in front.** Neither one changes
place: positions are identical before and after, and all that changes is which is on top. The move
is the one you would make with a card — the two slide apart, trade places in the stack out where
nothing is overlapping, and slide home — three ordered phases over about 600ms, in
`core/cardSwap.ts` so its shape can be stepped in a test.

**Only the cover moves.** The record stays exactly where it is, which means the tonearm has nothing
to follow and the stylus never leaves the groove it is playing. A card you push out and tuck under
is one object moving, not two.

It could not always. With the sleeve at the left edge of the frame there was less room beside it
than the overlap was wide, so the cover could never get clear on its own and the record had
to give way too — taking the arm with it, which is what kept the stylus on its groove then. Centring
the arrangement gave the cover the room to do the whole move itself, and the record and the arm now
hold still. The cover ends 16px clear of the record, which is what lets the stacking flip during
the hold rather than as a pop inside the overlap band.

The arm is drawn above both cards. The move raises the record above the cover, and anything at a
lower layer than that is painted over by it — the arm included, which is a thing to get wrong once.

The gesture is purely visual: playback is untouched, and the record remains the play/pause target
so the two never collide. The order is remembered for the session.

**Its chrome is the same bar as everywhere else.** The browser bar sits at the bottom centre in all
three looks, with the same Playlists and Queue panes and the same view switcher, and it is summoned
and dismissed by the same click on the empty field.

It was not always. The flat-lay shipped first with a transport pill of its own — library, the
current track with play/pause, queue — plus a gear at the top right and a round `···` button at the
bottom right to carry the view switcher, since the bar was not drawn in this look. It read well and
it was still wrong: two pieces of chrome doing one job means two places to change when the job
changes, and the view switcher ended up somewhere it was not in either of the other looks. One bar.

The one thing that had to come with it: **everything lying on the paper absorbs its own click**.
The chrome gesture is a click that reaches the field, so the disc, the cover and the arm all stop
propagation — otherwise play/pause would summon or dismiss the bar every time, and the
cover could not be turned over without the chrome flickering.

**Still to come — Console (M5).** Split layout: front elevation on the left with grille, volume knob
and three transport buttons, disc and tonearm on the right. It becomes a fourth look rather than a
rewrite.

### Lyrics, and where they come from

**Spotify has no lyrics endpoint.** The lyrics in the Spotify client come from an internal service
that is not part of the Web API and that Vuelta cannot legitimately call. So the lyrics view reads
**LRCLIB** (lrclib.net): free, no API key, and genuinely time-synced, returning ordinary LRC with
`[mm:ss.xx]` stamps.

- One lookup per track, by title, artist, album and duration, and **only while the view is open**.
  Cached for the session, misses included. SECURITY.md records what is sent.
- A line lights up `LYRIC_LEAD_MS` before it is sung and goes out as the next one leads in. That
  rule is pure, in `core/lyrics.ts`, so the fade can be stepped in a test rather than watched.
- The active line is resolved from the **live clock**, not from `readout`, which refreshes four
  times a second and would land every line up to 250ms late.
- Coverage is community-contributed. A track with none says so plainly; a track with unsynced words
  shows them, greyed, and says they do not follow the song.

---

## 13. Track transitions

Full record-swap animation, **anticipated rather than reactive**.

The trap: polling is 3–5 seconds behind, so by the time a poll reports a track change the new song is already well underway. A swap animation starting then lands absurdly late.

**The sequence:**

1. On track start, call `GET /me/player/queue` and cache `nextAlbumArtUrl`.
2. When the local clock reads `durationMs − progressMs ≈ 2000ms`, begin the arm lift.
3. Play the swap across the actual boundary so the new label settles as the first bar hits.
4. If the user skips manually in Spotify, the next poll surprises us. That is a *load*, not a boundary: the record simply slides out of the sleeve, with no retract and nothing to crossfade.

**The shape, as built** (`core/transition.ts`):

| Phase | Duration | What moves |
|---|---|---|
| `retracting` | 700ms, ease-in-cubic | the disc slides back behind the sleeve |
| `swapping` | 220ms | nothing: the disc is hidden, and the art and label change here |
| `extending` | 900ms, ease-out-cubic | the new disc slides out |

**Budget: 2–3 seconds total**, and the above is 1820ms. Longer and skipping through tracks becomes painful.

**The swap must play once.** The anticipated swap runs about two seconds before Spotify agrees the track has changed, so the confirming poll arrives *after* it has finished and lands on an idle machine — which reads as a fresh load and animates the whole thing a second time. `Transition.expecting` is what absorbs it. This was observed in the running app before it was fixed: a second slide starting 1.3s after the first had settled.

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

1. ~~Background treatment for the player~~ — **settled, and it is two answers.** The machine looks (Main, Lyrics) keep the **dark field**: the unit floats on the app background, with no desk surface, no ground plane and no contact shadow. The flat-lay (§12) is lit instead, on a **warm paper field, `#EEEAE7`**, with a faint grain and a very soft vignette — it is a photograph of two objects lying on a desk, so it needs the surface the machine does not. Light mode only for now: a dark variant of that scene needs a different light model and different material values, and is not worth building twice. The tokens (`--paper`, `--ink`, `--disc`, `--metal`) exist so it can be.
2. ~~The paused-position marker on the disc~~ — **dropped, and worth revisiting.** It was dropped because the cue-lever pause left the arm hovering at its angle, which was itself the position indicator. Pause now parks the arm (§11), so while paused nothing on the disc shows where playback stopped. Dragging still works and still commits on release, so nothing is broken — but the thing the marker was for has come back.
3. Auto-launching the Spotify client via the `spotify:` URI scheme when no device is found, as an M7 stretch goal. Needs a polling loop with a timeout and a graceful fall back to NO_DEVICE.
4. ~~Whether the SETUP flow gets its own milestone~~ — **settled: folded into M0**, as built.
