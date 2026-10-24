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
- **Which track is *drawn* needs the same treatment.** `display` follows the polled track, so after
  a skip it sits on the old cover until the poll answers — measured at ~1.6s, and up to the full
  3–5s interval at worst, with the music already changed. `next` therefore writes a display
  override from the queue head, which M6 has pre-fetched anyway, and the loop honours it until the
  poll reports *some other* track or the TTL runs out. Writing it without the override and letting
  the loop recompute does not work: the next frame reads the stale poll and puts the old cover
  straight back, which showed as the new cover appearing, reverting, and arriving again a second
  later. `previous` gets no guess — the queue only looks forward — so it gets the re-poll alone.
- **A skip also asks the poll again**, at 300ms and 900ms, rather than waiting for its own
  schedule. One re-poll is not enough: at 300ms Spotify often still reports the old track.
- `seek` commits on drag release only, never during the drag.
- `volume` throttled to ~1 call per 400ms.
- Handle 429 with `Retry-After`.
- `GET /me/player` returning **204 with an empty body is not an error** — it is the NO_DEVICE state.
- **The lid leads the music, on the automatic launch only.** The sequence is: fetch Spotify, make
  it the active device **without starting it**, let the machine appear with its lid shut, open the
  lid, then send play. Arming without playing is what makes this possible — it ends the no-device
  state, which is what puts the deck on screen at all, and the lid cannot rise on a screen that has
  no deck. Pressing play by hand is never held back; only this one path pays the wait.
- **The sequence lives in `useSync`, not on the screen that starts it.** Arming the device ends the
  no-device state, so `NoDeviceScreen` is unmounted halfway through and would take the rest of the
  sequence with it. The screen owns the one-shot that begins it and the message if it fails;
  everything after the device appears belongs to `useSync`, which already owns the lid and actions.
- **Vuelta fetches the deck, once.** Landing on NO_DEVICE with nothing to control is a dead end the
  app can get itself out of: `main/spotify/launch.ts` opens the `spotify:` URI, waits for the
  client to register as a device, and transfers playback to it with `play: true` — one call, because
  a transfer followed by a separate play races itself.
- **Once per session, and only on startup — this is the rule that matters.** The app reaches
  NO_DEVICE two ways that look identical from inside: Spotify was never running, or the user just
  closed it. "No device, so launch it" turns the second into a fight the user can only win by
  quitting Vuelta first. The attempt is spent on first mount of the screen and never retried on its
  own; after that the button is theirs.
- **If any device already exists, it launches nothing.** An idle phone is something the user can
  already reach, and opening a second player on top of it is presumptuous.
- **Every failure here is silent unless named**, so `LaunchSpotifyResult` carries the cause rather
  than a boolean: the URI goes nowhere when Spotify is not installed (`openExternal` rejects, which
  is the only way to tell that from a slow start); a signed-out client never registers, so there is
  a 25s ceiling rather than a loop; and an account with nothing to resume accepts the transfer and
  then plays nothing — which is now the *play's* answer to give, since the transfer no longer
  starts anything. That play goes through the bridge rather than `engine.actions.play()`, which
  returns nothing: it is the one play in the app whose result is needed.
- **No new scopes.** Devices and transfer both ride on the two already granted, which matters
  because a refresh never widens them.

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

- **One track = one record.** In the machine looks the centre label is that track's album art. In the flat-lay it is a **printed record label** — cream stock, dark ink, 45% of the disc, title above the spindle hole and artist below, small print curving round and a barcode under the artist. **Everything on the record turns with it**, the label and its text included — nothing is held upright. The title and artist were counter-rotated to stay readable, and that left the middle of the disc dead still, which is the one thing that stops it reading as a record at all. The label is not where you read the title; the bar is. The album art is on the **sleeve** there, once, never twice in one frame.
- Arm sweep: `REST_ANGLE` −12°, `START_ANGLE` 0°, `END_ANGLE` 22°.
- **The park is a pose, not an angle.** The flat-lay parks the arm vertically, clear of the disc, by drawing any `armAngle` at or below `START_ANGLE` as that pose and easing between. `REST_ANGLE` keeps its meaning in core and is never re-tuned per skin.
- **The flat-lay's arm geometry is solved** (`skins/flatlay/geometry.ts`), because placing it by eye does not close: a pivot far enough out to look right cannot reach the inner groove, and forcing it needs an arm half the width of the window. `solveArm` bisects for the one pivot distance that puts `armAngle` 0 on the outer groove and 22 on the inner.
- **Disc click** = play/pause. **Disc drag sideways** = skip: left for the next track, right for
  the previous, the way a stack of cards is pushed along. **Arm** = drag only.
- **The swipe rule is one pure module**, `core/discSwipe.ts`, shared by both skins: what counts as
  a drag rather than a click, how far the record follows, and what a release means. The flat-lay
  drags a div and the machine looks drag a mesh, but none of those three answers was going to stay
  the same if each skin worked it out for itself.
- **The slop and the threshold are asymmetric on purpose.** 6px stops a press that wobbles from
  being a very short swipe; 90px is what a release needs to change the track. The gap between them
  is the whole safety margin: a skip taken for a play/pause removes the song and has no undo, while
  a play/pause taken for a skip costs one more gesture.
- **The record follows, then springs home.** `swipeOffset` is asymptotic — it leaves at the
  pointer's own speed so it does not feel stuck, and falls away toward a ceiling so a long drag
  cannot throw it off the paper. Held exactly where the hand has it while the press lasts and
  damped home afterwards; damping *during* the drag reads as lag, not as weight.
- **Follow the drag on the `window`, never on the element.** A 90px throw leaves the disc long
  before the release, and pointer capture does not hold it — measured, a drag from the record out
  past its rim landed two moves, no release at all, and a distance of 504px gathered from a later
  pass back over the disc. `event.target.setPointerCapture` is the pattern both arm drags use, so
  they likely have the same hole.
- **In the flat-lay the gesture can only start on the exposed part of the disc**, because the
  sleeve covers its left half and takes the press there. That is the cover's own target, and the
  two do not collide.
- **Pause parks the arm.** Pause lifts the stylus a few millimetres *and* returns the arm to its rest position — the cradle in the machine looks, the vertical park in the flat-lay. The platter still spins down. This reverses the earlier cue-lever rule, where the arm hovered at its current angle: a paused turntable that has visibly stopped reads better than one frozen mid-sweep, and the rest position is the only part of the travel that says "not playing" on its own.
- The arm **stays draggable while paused** and seek still commits on release; it simply returns to rest afterwards, because it is still paused. A drag outranks the park — `armAngleNow` in `core/armMath.ts` is the one place that ordering lives, and it is the same in every look.
- **The lid answers the music.** Whenever playback is playing and the lid is shut, it opens itself
  — a closed lid over a turning record is the app contradicting itself. This is the only
  music → lid direction; everything below about lid → music is unchanged. It runs for the whole
  session, not just at startup, because the record can start from the Spotify client at any time.
- **The waiting state is the machine, not a page.** NO_DEVICE keeps the deck on screen with its
  lid shut and puts the message in a strip along the bottom, on the browser bar's line. A page of
  text made an ordinary wait look like an error and hid the thing worth watching — and it also
  deferred mounting the canvas, so the lid's travel happened behind a blank window. With the
  machine up throughout, the scene is long since drawn by the time a device appears and the
  opening is simply seen. Measured from an empty start: deck visible at 1.8s with the lid shut,
  five seconds of it, lid opens at 6.9s.
- **The lid stays shut until the machine is on screen, whatever the music is doing.** Connecting is
  not the same moment as appearing: finding or arming a device mounts the 3D canvas from nothing,
  and measured across three cold mounts the machine is not drawn for about 1.0–1.2s (1222, 1044,
  1039ms). Spotify often resumes by itself when launched, so `isPlaying` can be true before the
  canvas has drawn a frame — the lid then travelled through a blank window and the deck appeared
  already open. `LID_HOLD_AFTER_CONNECT_MS` makes the opening wait for the machine to exist on
  screen; the music only says which way it should go. Measured after: the shut deck is visible for
  about 1.0–1.8s before the lid moves.
- **A lid shut by hand wins for 5 seconds.** Closing is the stop gesture, so it pauses and usually
  settles itself — a paused deck has no music for the lid to answer. But if the pause does not land,
  or the music is really on another device, `isPlaying` stays true and the lid springs open under
  the hand that just shut it. `LID_HELD_SHUT_MS` is that guard.
- **Stamp it with `performance.now()`, never `Date.now()`.** The frame loop compares against the
  rAF timestamp, which counts from page load; epoch milliseconds against it give a difference of
  about −1.8e12, which is never greater than the grace. The lid could then never reopen at all,
  and the first open at startup came five seconds late while the rAF clock climbed past the window
  from zero. Both symptoms, one mixed clock.
- **The view needs no equivalent.** `Stage` unmounts while there is no device and remounts when
  playback appears, so the look resets to Main on its own every time the app comes back from
  having nothing to control — and after that the user's choice stands. Playback starting again
  must not pull them off Lyrics or the close-up.
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
| **Main** | The whole machine with a speaker either side, centred, now-playing panel at the right. |
| **Lyrics** | Machine left, a bare column of synced lyrics at the side **in place of** the panel. |
| **Close-up** | A sleeve and a record lying on a sheet of paper, seen from overhead, with a tonearm, and the machine shrunk to a **preview in the top-left corner**. |

- **The speakers are Main's alone.** A bookshelf cabinet either side of the deck, in the plinth's
  wood with grille cloth and the same plastic feet — part of the unit, not separates standing
  nearby. The Lyrics view and the close-up's corner preview show the bare deck.
- **Which means the camera frames two different machines.** `FIT_BOX_WITH_SPEAKERS` is about 47%
  wider than `FIT_BOX`, and `fitCamera` takes a `speakers` flag and picks between them — it is
  also in the cache key, or the second look would be handed the first one's answer. The deck pays
  for the width: the turntable is visibly smaller in Main than in Lyrics. That is the price of
  having them in one look and not the others, and it was chosen knowing it.
- **Only the width changes.** The speakers stand well below the lid's open tip, and the vertical
  solve works off a profile of the machine rather than off that box, so it is untouched; they are
  shallower than the lid, so the depth is too; and they are symmetric about the plinth, so the
  centre holds.
- **Nothing about them moves or responds.** They do not pulse with the music, because Vuelta has
  no idea what the music is doing — `audio-features` and `audio-analysis` both return 403. A
  speaker that bounced would be inventing it.
- The lyrics column is **content, not chrome**: it does not fade with the click gesture, and it
  reserves the right edge so the camera frames the machine beside it.
- **The close-up is a different skin, not a second camera.** `skins/flatlay/` draws it in DOM and
  SVG; `skins/3d/` draws the other two in one `<Canvas>` with one camera. The flat-lay scene is
  flat and lit, every value in its spec is a CSS value, and nothing in it is a three.js object.
  Keeping it in the canvas is what forced the layer system, a scissored second viewport and a
  reserved band in the camera fit; all of that is deleted.
- **The machine is a preview in the corner, not absent.** This reverses "no machine at all, not even
  a picture of one". It is not a second scene or a second viewport: it is the *same* canvas and the
  same camera, given a 413×244 box in the top right to frame themselves in, so the only thing that changes is the
  size of the element the renderer is already drawing into.
- **The preview has no field behind it**, and neither does anything else: `Staging` paints no
  background at all now. It was a `transparent` prop for a while, so the preview alone could sit on
  the flat-lay's paper; with one backdrop behind the whole app there is nothing left to switch, and
  the prop and the flag that fed it are gone.
- **The preview takes no clicks at all, box included.** Its contents cannot, by `!important`: R3F
  sets `pointer-events: auto` inline on its own container, which outranks anything inherited, and
  without the override a click raycasts into the real scene and works the lid. The box is
  click-through too, which is the opposite of the disc and the cover — those are objects lying on
  the paper and absorb their own click, but an invisible box is not an object, and swallowing
  clicks there would leave a dead rectangle in a corner that otherwise responds everywhere.
- **The preview lives in the top right because that is where the room is.** On the left it had to
  thread a wedge above the sleeve's top edge, and that edge *slopes* — the cover behind lies over
  four degrees — so every pixel lower cost about 1.8px of width and it could not be made both
  larger and lower. The right corner is bounded only by the armboard below it, which leaves 4.8px. Both `top` and `right` are negative, because the inset you
  see is the box's own empty margin rather than its edge — which is what lets the box hang off the
  window while the machine stays inside it. Growing the preview depends on that: the ink runs about
  73% of the box's height whatever the size, so the bottom margin cannot shrink to clear the
  armboard and the room has to come from above the window. At under 5px the armboard is now the
  whole budget.
- **The preview scales with the window, and must.** Everything in its rule is in design-box pixels
  carried by `--fit: min(100vw / 1280, 100vh / 800)` — the same fit the flat-lay uses, so the two
  shrink in step. In fixed px the machine kept its size while the scene shrank around it and
  swallowed a restored-down window; only maximised looked right, which is the tell.
- **Chrome does not scale, and that used to cost the preview its corner.** The settings gear is
  app chrome: fixed size, pinned a fixed distance in, because a gear that shrank with the scene
  would stop being clickable. While it sat in the top right it therefore took proportionally more
  of that corner as the window shrank, and the preview's scaled offset walked the machine into it
  — −5.7px on an 820×560 window — which needed a `max()` clamp. **The gear has since moved to the
  browser bar's line and the clamp is gone.** Anything fixed-size put back in that corner brings
  the problem with it. Verified per pixel at 640×520 (the app's minimum), 820×560, 960×620 and
  1100×700, both resting arrangements: nothing covered.
- **The maximised window gets a nudge the others do not.** A `@media (min-width: 1400px) and
  (min-height: 800px)` rule puts the preview 25px further right and 15px further down. It is a
  breakpoint rather than an addition to the scaled offsets because it was asked for on a maximised
  window with the smaller layouts left alone, and the scaled version would move it at every size.
  The two numbers are not independent: measured at a maximised 1536×842 the machine has 75px of
  clear window to its right but **6px** above the armboard, so dropping it 15px alone would put it
  9px over the board — going right far enough to clear the board's right edge first is what makes
  the drop free. The 25 buys the 15.
- **What has to clear them is the machine, not the box.** With no field behind it the box's empty
  margins lie over anything with nothing showing; the ink is 191×179 of the 413×244 (figures at a 1280×800 window).
- **Measuring that needs care, and two obvious methods are both wrong.** Never box against box:
  the cover behind is a turned square, so the corners of its rect are bare paper and a rect
  overlap there covers nothing — that test reported a collision on the left that did not exist.
  And never diff two screenshots while the deck is playing: the record turns once every 3.6s, so
  disc pixels differ between any two captures, and because the groove pattern is near-periodic
  they leak through a stability mask as well. **Pause the deck, let it spin down and park, then
  assert nothing moved between two reference shots before believing the third.** Threshold
  generously too: compositing the canvas lifts near-black disc pixels by about 15 levels on its
  own. `SCENE_SCALE`, the preview's size and the card swap all move these margins.
- **The scene's size is one multiplier, applied last.** `SCENE_SCALE` zooms the whole design box in
  `fitBox`; every other number keeps the value the spec gives it, and nothing moves relative to
  anything else. It is folded into `fitBox` rather than applied by the skin so the box re-centres
  as it grows — applied afterwards it scales about the top-left corner and slides the scene away.
  The box is then *larger than the window and meant to be*; what has to stay on screen is
  `CONTENT`, the arrangement's own bounds, which has room to about 1.52.
- **The card swap is the one thing the zoom does not fit.** The cover slides a clear disc-width
  left at the top of the move — further out than any resting state — and at `SCENE_SCALE` 1.2 that
  lands about 71px off the window. On screen at rest, clipped only mid-move. The ceiling that would
  keep it in is ~1.08, so it is a real trade; a test pins it so it stays a decision.
- **Switching to it shrinks the canvas, it does not unmount it.** Tearing the `<Canvas>` down throws
  away the generated environment map and every texture and rebuilds both on the way back, so
  `Stage` sets `display: none` on `.stage__machine` instead.
- **There is no system title bar.** `titleBarStyle: 'hidden'` hands the whole window to the
  renderer and leaves Windows drawing only the caption buttons, as a transparent overlay — so the
  backdrop runs to the top edge and the buttons sit on the artwork. A strip of OS grey across the
  top read as a different application once the field became a blurred cover; measured, Windows
  paints it a flat `rgb(31,31,35)` from the system theme, which answers to nothing on screen.
- **Hiding it costs two things, and both have to come back.** The title and icon go, so `TitleBar`
  draws the name itself; and there is nothing left to pick the window up by, so that strip is a
  **drag region**. It is only 34px tall and no taller, because a drag region swallows clicks and
  the close-up's corner preview is directly beneath it. It lives in the shell, not the stage, so
  the setup and no-device screens can be moved too.
- **`symbolColor` is the one thing that cannot follow the artwork.** The caption glyphs are drawn
  by Windows over whatever the cover happens to be, so they are set light once and left alone.
- **One field for all three looks, and it is the playing cover.** `app/FieldBackdrop.tsx` draws the
  album art behind the whole app, blurred to 60px so only its colour survives, dimmed to half
  brightness and lifted slightly in saturation. **Nothing else paints a background any more**: the
  three.js scene's `<color attach="background">` is gone and the flat-lay's `--paper` is
  `transparent`, so the canvas and the paper both let it through. Two of those to keep in step
  through every track change was one too many.
- **Why those three numbers.** The blur has to be past recognition or the backdrop competes with
  the sleeve for attention; the dimming is what keeps white chrome legible over a pale cover and
  keeps the jacket the brightest thing on screen. Measured against the alternative — extracting a
  single colour — the average of a sleeve is always mud, and its most common colour matches so
  closely that a dark cover dissolves into its own field.
- **A null cover is a gap, not an instruction.** The backdrop keeps the last one rather than
  clearing: between tracks the poll can briefly report no track at all, and clearing drops the
  whole field to the bare `--bg`, which reads as the background going dark and coming back instead
  of one cover dissolving into the next.
- **Two art layers, never one.** `background-image` does not transition, so a track change fades a
  new layer over the old one and drops the old one when it is covered. Keeping it would leave a
  second full-window blur running for the rest of the track, which is the most expensive thing on
  screen.
- **The backdrop is `.backdrop`, not `.field`.** `.field` is already the setup screen's form row;
  a full-window absolutely positioned rule under that name takes the Client ID form off the screen
  on first run.
- **The flat-lay is laid out in a fixed 1280×800 design box**, scaled to the window by one
  `transform` (and zoomed by `SCENE_SCALE`; see below). That is what lets the spec's pixel values — shadow offsets, hairlines, the groove
  period — be taken literally. Nothing reflows; the composition is one shape at one aspect.
- **The sleeve's art is filled and slightly overscanned.** `object-fit: cover` and a 3% scale, so
  it runs past the sleeve and is clipped. Plenty of covers are drawn with a pale border baked into
  the artwork: the file is square and fills the sleeve exactly, and the band at the top and bottom
  is the picture's own. Nothing in the layout can tell that from the art, so overscanning is the
  only way to be sure none shows. It costs about 8px a side of a 528px cover — enough for a
  hairline border, not for a thick one, and it should not try to be.
- **The record is 5% smaller than its sleeve** (`RECORD_SCALE`), as a 302mm LP is to a 315mm
  jacket. Flush with it, the disc does not look like it could go back in. The label, hole and lands
  scale with it.
- **Vinyl is drawn as reflection, not colour**: a near-black base, two specular arcs set ~90° off the
  lamp rather than toward it — a groove is a circular grating — smooth lands glossier than the
  grooved band, and a rolled edge. The arcs are static; the disc turns under them.
- **The arm's cast parts need a lit edge.** Black on near-black vinyl has no value difference at
  all — the headshell vanished the moment it crossed the disc. The silhouette has to be stroked.
- **The spin needs something that is not rotationally symmetric.** The grooves are perfect
  circles, so turning them changes no pixel: the black field read as dead still however fast it
  was going, and only the label moved — half of which the cover hides. The rotating conic on
  `.flatlay__spin` is the one asymmetric thing on the record and so the only thing that can show
  it turning. It was 0.035 white over a `#0c0c0e` disc, about eight levels, which is the same
  mistake the grooves made; tripled, a fixed point on the field now swings 22–25 levels per
  revolution. The static sheen stays where the lamp is; this one goes round.
- **The groove rings are meant to be seen.** `GROOVE_PERIOD` is the one authority and the skin
  hands it to CSS. The design's ~2px at nine levels of contrast was invisible; what fixed it was
  mostly contrast, and the wider period keeps the spacing even rather than beating against the
  pixel grid once the box is scaled.
- **Two resting arrangements, both centred.** In front the sleeve covers **half** the disc
  (`TUCK_FRACTION`, and the spindle lands exactly on the sleeve's right edge); behind it draws back
  to a **quarter** (`TUCK_FRACTION_BACK`), so the record it is now under is mostly clear of it and
  the label reads. `layoutFor` solves each, and because both are centred the move is symmetrical —
  the cover gives up exactly what the record takes, 52px each way. This
  replaces the earlier rule that the two never overlap, which belonged to the 3D close-up, where
  whichever card sat behind had a bite taken out of it by the other. In DOM, paint order settles it
  and nothing is lost.
- **Clicking the cover trades it with the record in the stack.** Positions are identical before and
  after; only which one is on top changes. The move is the three ordered phases of
  `core/cardSwap.ts` — apart, flip, home — and the flip happens during the hold, where the two are
  clear of each other, so it is never seen as a pop inside the overlap band.
- **The cover moves first, then the disc adjusts.** The cover slides clear, trades places and
  repositions during the hold — all while nothing overlaps — and only once the stacking has flipped
  does the record ease across to the other layout, arm with it. Damped, not timed, so it reads as
  settling rather than as a second slide.
- **The cover's clearance travel lerps toward `COVER_SHIFT`, it does not add to it.** The
  reposition and the travel are both at full value at the end of the hold; adding them took the
  cover 13px off the left of the box.
- **The arm is solved, then nudged 12px right** (`ARM_NUDGE_X`) to open the gap at the rim. The
  solve fixes the pivot's *distance* from the spindle, so the nudge is slack being spent, and it is
  spent out of the **lead-in**: the stylus sets down 5.8px into a 13.3px band of smooth land
  instead of exactly on the first groove, which is how a needle is actually dropped. The ceiling is
  ~27px, where the stylus would touch the rim. It is the one number in `geometry.ts` that is not
  derived — do not re-tune it by eye, and do not let the lead-in, the label or the overlap shrink
  without re-measuring it. It also bought the clearance that keeps the stylus **off the album
  cover** for the whole sweep, which it previously crossed by a whisker at the end of every side.
- **The arrangement is centred by derivation, not by eye** — `SLEEVE_LEFT` solves for it from the
  composition's width. The arm reaches well past the record, so the bearing circle is the
  right-hand edge and the thing is much wider than the two cards suggest; centring on the cards
  left a third of the frame empty.
- **The cover lies askew when it is behind**, tilted four degrees anticlockwise so its upper right
  corner rides higher than its upper left. Only the back of the stack gets it; the front sits
  square, and the tilt eases on with the depth rather than snapping once the move lands.
- **The arm sits above both cards** (`z-index: 4`). The card move raises the record to 2, and
  without it the record paints over the arm for as long as the cover is behind.
- The disc stays the play/pause target, so the two gestures never collide, and the card move is
  purely visual — playback is untouched.
- **The settings gear stands on the browser bar's line**, out at the right edge, in every look. The
  two are summoned and dismissed by the same gesture, so putting them on one level reads as a
  single piece of chrome instead of two in opposite corners. The bar is centred and much narrower
  than the window, so the corner past it is free in all three: the now-playing panel stops 75px
  above that line and the lyrics column likewise. Its menu opens **upward** — a plain column opens
  downward, which from there leaves the window. The 3px in its `bottom` is half the difference
  between the bar's height and the button's, which is what puts them on a shared centre line
  rather than a shared bottom edge.
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
- A non-200 means "no lyrics" — never an error screen — **except when the body says the service is
  unwell**. `/api/get` has been seen returning 503 for an unmatched lookup, which is why every
  non-200 used to count as a miss; but a real outage names itself (`ServerOverloaded`), and the
  difference matters because **a miss is cached for the session**. One busy minute would otherwise
  mark a track lyric-less until the app restarts. An outage returns `ok: false`, which is not
  cached and is retried.
- **`/api/get` alone finds far less than LRCLIB has.** It matches on duration and matches it
  tightly, and Spotify's figure and LRCLIB's routinely differ by a second or two for the same
  recording. Three tracks the app called lyric-less had 1, 6 and 5 synced results waiting in
  `/api/search`. So a miss from the exact lookup falls through to the fuzzy one, ranked here by
  duration closeness and synced-over-plain, because search returns the best *text* match and that
  is not necessarily the recording playing. Measured across five tracks, coverage went from 1 in 5
  to 4 in 5.
- The column is set after Spotify's own lyrics view: **large and bold**, and **one line lit at a
  time**. Everything not being sung is faded to the same value, whether it has gone or is still
  coming. It was graded by distance for a while, so the lines either side stayed bright and the
  eye had three or four places to be; one lit line leaves it nowhere to go but the right one.
- **The type is sized to hold about five lines**, not ten — roughly double what it was.
- **The column carries no transport at all.** It had a skip row under the words for a while; it is
  gone again, and so this view has no previous or next. Play and pause do not need one here — the
  machine is beside this column and the disc is the control — but skip has nowhere to go, which is
  the standing cost of the bare column. `.lyrics` still declares a second grid track for the row
  that used to sit there.
- **The body needs `min-height: 0` and a capped padding.** A grid item's automatic minimum is its
  content, and the body's air is set in *padding*, which resolves against **width** however tall
  the box is — widening and shortening the column in one go took it to 184px a side inside 362px
  of column. Padding puts a floor under an element's height that `min-height: 0` cannot lift, so
  the track grew to fit it and anything below the body left the bottom of the column. Hence
  `min(40%, 17vh)`. It still matters with nothing under the body, because the padding alone would
  otherwise outgrow the column.
- **The column is half the height it was and centred in the gap**, not stretched between two
  insets and pinned to the right edge. The offset is *derived*, not chosen: the camera frames the
  machine into whatever the column leaves it, so sliding the column left widens the reserve,
  shrinks the machine, and moves the very edge the centre was measured from — a fixed point. A
  flat offset will not hold it either, because the width is clamped, so past a certain window the
  column stops growing while the gap keeps going. The machine's right edge measures a steady
  ~0.545 of the window, which gives `right = 22.75vw - column/2`, and that lands within ~9px at
  every size tried.
- **Through an intro nothing is lit.** `activeLyricIndex` returns −1 until the first line is due,
  so no line carries `data-state='now'` and the whole column sits faded until the singing starts.
  That falls out of the rule rather than being a case of its own, so do not add one.
- **The column is the words and nothing else.** No card, no background, no border, no shadow — the
  lyrics stand on the field with no edge around them. It had a title and artist above and a
  transport below, each in its own grid track, and for a short while a blurred sleeve behind as a
  ground; all of it is gone. Play and pause still have a home in this view — the machine is right
  there and the disc is the control.
- **When there are no lyrics, the message goes in the middle, with skip under it.** The air above
  and below the body exists so the first and last lyric can reach the centre while scrolling; with
  one sentence there is nothing to scroll, and that padding would hang it near the top where the
  first lyric would have been. `bodyMode` picks the layout — `lines` and `plain` scroll, `note`
  centres.
- **There is no word-by-word fill**, which the reference has. LRCLIB gives **line** timings only,
  so a per-word highlight would have to be invented from the line's duration and would drift off
  the actual words. The line-level lead in `core/lyrics.ts` is the honest version of the same idea.
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
- **A button given an explicit size must clear the global padding.** `button {}` sets
  `0.5rem 1.1rem`, and with `box-sizing: border-box` that is wider than any icon-sized button: the
  content box collapses to nothing, the grid track gets laid out after the left padding, and the
  glyph sits half its own width right of centre and low. The button also comes out wider than the
  size it asked for, which is the tell. It caught the settings gear, and the lyrics transport back
  when that existed.
- Keep every Spotify API call behind one module. Spotify changes their terms often; a migration should touch one file.
