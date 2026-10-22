/**
 * The flat-lay skin: a sleeve and a record lying on a sheet of paper, seen
 * from overhead, with a tonearm.
 *
 * A second skin rather than a second camera. The old close-up was drawn by a
 * camera into a scissored region of the 3D canvas, which is what forced the
 * layer system, the sealed inset pass and a reserved band in the camera fit.
 * None of that exists here: the scene is flat, every value in the spec is a
 * CSS value, and `core/armMath.ts` already owns the angle-to-time mapping that
 * the drag needs.
 *
 * Layer rule, unchanged: this receives `RenderState` and `Actions` and nothing
 * else. It has no idea Spotify exists. The chrome -- §8's transport pill --
 * is not here either; it belongs to the view, beside the skin, exactly as the
 * now-playing panel and the browser bar do for the machine.
 *
 * CLAUDE.md: "Never animate through React state." One rAF writes the disc's
 * rotation, the label's counter-rotation, the record's slide and the arm's
 * bearing straight to refs. React renders this tree once per track.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'

import { cardSwap, CARD_SWAP_MS } from '../../core/cardSwap.js'
import { ARM as CORE_ARM, PLATTER_RPM, type Actions, type RenderState } from '../../core/contract.js'
import { isSwipeDrag, swipeOffset, swipeOutcome } from '../../core/discSwipe.js'
import {
  ARM,
  ARM_LOCAL,
  ARM_REACH,
  armBearingDeg,
  BOX,
  fitBox,
  GROOVE,
  PIVOT,
  RECORD,
  RECORD_CENTER_X,
  BACK_SHIFT,
  BOARD_OFFSET,
  RECORD_TRAVEL,
  SLEEVE,
  SWAP,
  type BoxFit,
} from './geometry.js'
import { useArmDrag } from './useArmDrag.js'

/**
 * §2's paper grain, generated rather than fetched: the packaged app's
 * Content-Security-Policy forbids loading an image, and this costs nothing.
 */
/** Where the tube emerges from the pivot column, in the arm's own frame. */
const TUBE_START = 20

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E\")"

/** Frame-rate independent exponential approach. */
function damp(current: number, target: number, lambda: number, delta: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * delta))
}

/**
 * §5's catalogue number: texture, not information. Derived from the title so
 * it is stable for a track and different between tracks, which is all a piece
 * of texture has to be.
 */
function catalogueNumber(title: string | null): string {
  let hash = 7
  for (const character of title ?? 'untitled') {
    hash = (hash * 31 + character.charCodeAt(0)) % 100000
  }
  return `VLT-${String(hash).padStart(5, '0')}`
}

export type FlatLayProps = {
  /** Live state, mutated in place. Never a prop that changes per frame. */
  state: RefObject<RenderState>
  actions: Actions
  /**
   * The art to show, already resolved across a swap: during the hidden moment
   * of a record change the app hands over the incoming track's, so the skin
   * never has to know which side of the boundary it is on.
   */
  albumArtUrl: string | null
  title: string | null
  artist: string | null
  onArmDragStart: () => void
  onArmDragTo: (progressMs: number) => void
  onArmDragEnd: () => void
  /** A click that landed on the paper, not on an object lying on it. */
  onBackgroundClick: () => void
}

export function FlatLay({
  state,
  actions,
  albumArtUrl,
  title,
  artist,
  onArmDragStart,
  onArmDragTo,
  onArmDragEnd,
  onBackgroundClick,
}: FlatLayProps) {
  const host = useRef<HTMLDivElement | null>(null)
  const record = useRef<HTMLDivElement | null>(null)
  const spin = useRef<HTMLDivElement | null>(null)
  const armGroup = useRef<SVGGElement | null>(null)
  const armLift = useRef<SVGGElement | null>(null)
  /** The whole arm assembly, which travels with the record during a card move. */
  const sleeve = useRef<HTMLDivElement | null>(null)
  /** The arm assembly, which travels with the record when it adjusts. */
  const armShift = useRef<SVGGElement | null>(null)
  const board = useRef<HTMLDivElement | null>(null)
  /** The record's current shift, shared with the drag. */
  const shiftRef = useRef(0)

  // Which of the two cards is on top. Skin-local and purely visual: it moves
  // nothing but the stacking, and playback is untouched.
  const [coverInFront, setCoverInFront] = useState(true)
  const coverInFrontRef = useRef(coverInFront)
  coverInFrontRef.current = coverInFront

  /** Milliseconds into the current card move, or null when it is over. */
  const swapElapsed = useRef<number | null>(null)
  /** The order it is travelling from. Captured when the move starts. */
  const fromInFront = useRef(coverInFront)
  /** Arriving is not a move. */
  const settled = useRef(false)

  useEffect(() => {
    // Nothing animates on the way in. A move with nothing to travel is worse
    // than pointless: it would slide out, and if the loop went quiet before it
    // finished it would stay out.
    if (!settled.current) {
      settled.current = true
      return
    }
    fromInFront.current = !coverInFront
    swapElapsed.current = 0
  }, [coverInFront])

  const [fit, setFit] = useState<BoxFit>(() => fitBox(BOX.WIDTH, BOX.HEIGHT))
  const fitRef = useRef<BoxFit>(fit)
  fitRef.current = fit

  // Scale the design box to the window. Not per-frame work: it changes when
  // the window does, which is why it is allowed to be React state.
  useLayoutEffect(() => {
    const element = host.current
    if (!element) return

    const measure = () => {
      const rect = element.getBoundingClientRect()
      const next = fitBox(rect.width, rect.height)
      setFit((previous) =>
        previous.scale === next.scale && previous.x === next.x && previous.y === next.y
          ? previous
          : next,
      )
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  /**
   * Putting the needle down starts the record.
   *
   * A drag that ends on the groove is the gesture for "play from here", the
   * same as it is on a real deck — so a scrub while paused no longer leaves
   * the arm travelling back to its park the moment you let go. The seek is
   * committed first, by the handler this wraps; the play follows it.
   */
  const endDrag = useCallback(() => {
    onArmDragEnd()
    if (!state.current?.isPlaying) actions.play()
  }, [actions, onArmDragEnd, state])

  const drag = useArmDrag({
    stateRef: state,
    hostRef: host,
    fitRef,
    shiftRef,
    onDragStart: onArmDragStart,
    onDragTo: onArmDragTo,
    onDragEnd: endDrag,
  })

  // ---- pushing the record sideways ----------------------------------------
  // Press the disc, slide, release: left for the next track, right for the
  // previous. `core/discSwipe.ts` owns what counts as a drag and what a
  // release means; this only turns pointer events into distances and writes
  // the offset the frame loop draws.
  /** Where the press landed, in screen pixels. */
  const swipeFrom = useRef<{ x: number; y: number } | null>(null)
  /** How far the record is held from home, in design-box pixels. */
  const swipeHeld = useRef(0)
  const swipeDragging = useRef(false)
  /** Set once a press has travelled far enough to stop being a click. */
  const swiped = useRef(false)
  /**
   * The design box is scaled to the window, so a pointer moves in screen
   * pixels while the record is drawn in design pixels. The gesture is judged
   * in the first -- it is the hand's distance that matters -- and drawn in the
   * second.
   */
  const scaleRef = useRef(1)
  scaleRef.current = fit.scale

  /**
   * Start a swipe, and follow it on the *window* rather than on the disc.
   *
   * A throw worth 90 pixels leaves the disc long before the release, and once
   * the pointer is off it the element stops hearing. Pointer capture is the
   * obvious answer and does not hold: measured in the machine look, a drag
   * from the record out past its rim landed two moves and no release at all,
   * and the distance it did report was nonsense picked up from a later pass
   * back over the disc. The window hears everything, so the gesture finishes
   * wherever the hand ends up -- which is also what stops a half-finished
   * drag leaving the record held off-centre.
   */
  const onDiscDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const from = { x: event.clientX, y: event.clientY }
      swipeFrom.current = from
      swipeDragging.current = true
      swiped.current = false

      const move = (moved: PointerEvent) => {
        if (!swipeFrom.current) return
        const dx = moved.clientX - from.x
        const dy = moved.clientY - from.y
        if (!isSwipeDrag(dx, dy)) return
        swiped.current = true
        swipeHeld.current = swipeOffset(dx) / (scaleRef.current || 1)
      }

      const up = (released: PointerEvent) => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        swipeFrom.current = null
        swipeDragging.current = false
        // Home either way; the frame loop eases it back from wherever it is.
        swipeHeld.current = 0
        const outcome = swipeOutcome(released.clientX - from.x, released.clientY - from.y)
        if (outcome === 'next') actions.next()
        else if (outcome === 'previous') actions.previous()
      }

      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    },
    [actions],
  )

  const toggle = useCallback(
    (event: { stopPropagation(): void }) => {
      // Everything lying on the paper absorbs its own click. Without that the
      // click reaches the field underneath and toggles the chrome as well, so
      // play/pause would summon or dismiss the bar every time.
      event.stopPropagation()
      // A drag ends in a click as well, and a swipe that took the song away
      // must not also stop it. The slop in `isSwipeDrag` is what makes this
      // safe: a press that wobbles two pixels is still a click.
      if (swiped.current) {
        swiped.current = false
        return
      }
      if (state.current?.isPlaying) actions.pause()
      else actions.play()
    },
    [actions, state],
  )

  // ---- the frame loop ------------------------------------------------------
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    /** Disc rotation in degrees, and the speed it is approaching. */
    let angle = 0
    let degPerSec = 0
    let bearing = armBearingDeg(CORE_ARM.START_ANGLE)
    /** Where the record actually sits under the swipe, easing home on release. */
    let swipeNow = 0
    let lifted: boolean | null = null
    let front: boolean | null = null
    /** Where the record has got to on its way between the two layouts. */
    let recordShift = coverInFrontRef.current ? 0 : BACK_SHIFT.RECORD

    const frame = (now: number) => {
      // Clamped: a backgrounded window hands back one enormous delta, and an
      // unclamped one would spin the disc through several revolutions at once.
      const delta = Math.min(0.05, Math.max(0, (now - last) / 1000))
      last = now

      const live = state.current
      if (live) {
        // Spin up and down with weight. Spec §10: "Never an instant stop."
        const target = live.isPlaying ? (live.platterRpm || PLATTER_RPM) * 6 : 0
        degPerSec = damp(degPerSec, target, live.isPlaying ? 1.8 : 1.1, delta)
        if (degPerSec > 0.05) {
          // Clockwise from above, which is what a positive CSS rotation is.
          angle = (angle + degPerSec * delta) % 360
          // Everything on the record turns with it, the label included. The
          // title and artist used to be held upright by the inverse rotation,
          // which kept them readable and left the middle of the disc dead
          // still — and a record whose centre does not move does not read as
          // a record at all. Legibility was the wrong thing to optimise for:
          // the label is not where you read the title, the bar is.
          if (spin.current) spin.current.style.transform = `rotate(${angle}deg)`
        }

        // The card move. Both objects slide apart, trade places in the stack
        // out where they are clear of each other, and slide home.
        let out = 0
        let crossed = 1
        if (swapElapsed.current !== null) {
          swapElapsed.current += delta * 1000
          const progress = Math.min(1, swapElapsed.current / CARD_SWAP_MS)
          const move = cardSwap(progress)
          out = move.out
          crossed = move.crossed
          if (progress >= 1) swapElapsed.current = null
        }

        // The record follows the cover rather than moving with it: it eases
        // toward the layout the stacking has settled on, which starts when the
        // flip happens and finishes after the cover is home. That is the
        // "and then the disc adjusts" half of the gesture, and damping is what
        // makes it read as settling rather than as a second slide.
        const shiftTarget = front === false ? BACK_SHIFT.RECORD : 0
        recordShift = damp(recordShift, shiftTarget, 7, delta)
        shiftRef.current = recordShift

        // §9's slide rides on top of it: `transitionOut` is 1 at rest and 0
        // fully behind the sleeve. The two offsets simply add.
        // Held exactly where the hand has it while the press lasts, and
        // eased home the moment it ends -- damping during the drag would put
        // the record behind the pointer, which reads as lag rather than as
        // weight. The resistance is in `swipeOffset`, not here.
        swipeNow = swipeDragging.current
          ? swipeHeld.current
          : damp(swipeNow, 0, 9, delta)

        if (record.current) {
          const hidden = 1 - live.transitionOut
          record.current.style.transform =
            `translateX(${(recordShift - hidden * RECORD_TRAVEL + swipeNow).toFixed(2)}px)`
        }
        armShift.current?.setAttribute('transform', `translate(${recordShift.toFixed(2)} 0)`)
        if (board.current) board.current.style.transform = `translateX(${recordShift.toFixed(2)}px)`
        // The stacking flips in the middle of the hold, where nothing
        // overlaps, so the change is never seen as a pop. Decided before the
        // record reads it, because the record's adjustment hangs off it.
        const wantFront =
          swapElapsed.current === null
            ? coverInFrontRef.current
            : crossed >= 0.5
              ? coverInFrontRef.current
              : fromInFront.current
        if (wantFront !== front) {
          front = wantFront
          if (sleeve.current) sleeve.current.style.zIndex = wantFront ? '2' : '1'
          if (record.current) record.current.style.zIndex = wantFront ? '1' : '2'
        }

        // How far through to the back of the stack the cover is, 0 at the
        // front and 1 behind. At rest `crossed` is 1, so this is simply which
        // side it is on; mid-move it eases.
        const behind = coverInFrontRef.current ? 1 - crossed : crossed

        // The cover's resting place is not the same on both sides: in front it
        // covers half the disc, behind it draws back to a quarter. It changes
        // places during the hold, where it is clear of the record, so the
        // reposition and the change of depth happen in the same breath and
        // neither is seen against the other.
        if (sleeve.current) {
          const rest = behind * BACK_SHIFT.COVER
          // Toward the clearance position, not by it. Adding the two would
          // stack the reposition on top of the travel and take the cover off
          // the left of the box by 13px at the end of the hold, where both are
          // at full value; landing *on* COVER_SHIFT means the clearance is the
          // same however far the cover has already drawn back.
          const x = rest + out * (SWAP.COVER_SHIFT - rest)
          sleeve.current.style.transform =
            `translateX(${x.toFixed(2)}px) ` +
            `rotate(${(behind * SWAP.BACK_TILT_DEG).toFixed(3)}deg)`
        }



        // The arm. Anything at or below START_ANGLE is parked, which is a
        // *pose* and not a bearing on the groove band -- that is what lets
        // core's REST_ANGLE keep meaning "parked" without being re-tuned for
        // this scene's geometry.
        const span = CORE_ARM.START_ANGLE - CORE_ARM.REST_ANGLE
        const park =
          live.armAngle >= CORE_ARM.START_ANGLE || span <= 0
            ? 0
            : Math.min(1, (CORE_ARM.START_ANGLE - live.armAngle) / span)
        const onBand = armBearingDeg(
          Math.max(CORE_ARM.START_ANGLE, Math.min(CORE_ARM.END_ANGLE, live.armAngle)),
        )
        const want = onBand + (ARM.PARK_BEARING_DEG - onBand) * park

        // Damped rather than snapped: a poll correction should ease the arm
        // across, never jump it. A drag is the user's hand, so it tracks hard.
        bearing = damp(bearing, want, live.isDragging ? 26 : 6, delta)
        armGroup.current?.setAttribute(
          'transform',
          `rotate(${bearing.toFixed(3)} ${PIVOT.x.toFixed(2)} ${PIVOT.y.toFixed(2)})`,
        )

        // §7: lifted while paused, while dragging, and for the whole of a
        // record swap. An attribute rather than React state, so a pause does
        // not re-render the scene.
        const wantLifted = !live.isPlaying || live.isDragging || live.transitionPhase !== 'idle'
        if (wantLifted !== lifted) {
          lifted = wantLifted
          if (armLift.current) armLift.current.dataset.lifted = String(wantLifted)
        }
      }

      raf = requestAnimationFrame(frame)
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [state])

  // ---- the sleeve's crossfade ---------------------------------------------
  // §9 changes the art while the disc is hidden, but the *sleeve* is never
  // hidden, so its art has to dissolve rather than cut. Two slots: the
  // outgoing one underneath, the incoming one fading in over it.
  const [slots, setSlots] = useState<{ front: string | null; back: string | null }>({
    front: albumArtUrl,
    back: null,
  })

  useEffect(() => {
    setSlots((previous) =>
      previous.front === albumArtUrl ? previous : { front: albumArtUrl, back: previous.front },
    )
  }, [albumArtUrl])

  const recordLeft = RECORD_CENTER_X - RECORD.RADIUS
  const recordTop = RECORD.CENTER_Y - RECORD.RADIUS
  const labelInset = RECORD.RADIUS - RECORD.LABEL_RADIUS
  const holeInset = RECORD.LABEL_RADIUS - RECORD.SPINDLE_RADIUS

  return (
    <div className="flatlay" ref={host} onClick={onBackgroundClick}>
      <div className="flatlay__grain" style={{ backgroundImage: GRAIN }} />
      <div className="flatlay__vignette" />

      <div
        className="flatlay__box"
        style={{ transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})` }}
      >
        {/* §6: the armboard, the plate the pivot is mounted on.
            First in the box and carrying no z-index, so it paints under both
            cards — the record sits *on* the deck, and the board is part of the
            deck. Drawn over the disc it was a translucent plate lying across
            the rim, which is the wrong way round and the thing you notice.
            It still travels with the arm. */}
        <div
          className="flatlay__board"
          ref={board}
          style={{
            left: `${PIVOT.x + BOARD_OFFSET.x - ARM.BOARD_WIDTH / 2}px`,
            top: `${PIVOT.y + BOARD_OFFSET.y - ARM.BOARD_HEIGHT / 2}px`,
            width: `${ARM.BOARD_WIDTH}px`,
            height: `${ARM.BOARD_HEIGHT}px`,
            borderRadius: `${ARM.BOARD_WIDTH * 0.4}px`,
          }}
        />

        {/* The record, below the sleeve in paint order: §2's signature is that
            the sleeve occludes it, so the disc reads as half-pulled-out of the
            jacket rather than as a separate object parked beside it. */}
        <div
          className="flatlay__record"
          ref={record}
          style={
            {
              left: `${recordLeft}px`,
              top: `${recordTop}px`,
              width: `${RECORD.RADIUS * 2}px`,
              height: `${RECORD.RADIUS * 2}px`,
              // On the wrapper, not the disc: the sheen is a sibling and masks
              // itself against the same two radii.
              '--inner': `${GROOVE.INNER}px`,
              '--outer': `${GROOVE.OUTER}px`,
              '--groove': `${RECORD.GROOVE_PERIOD}px`,
            } as CSSProperties
          }
        >
          <div
            className="flatlay__disc"
            onClick={toggle}
            onPointerDown={onDiscDown}
            role="button"
            tabIndex={-1}
            aria-label="Play or pause"
          />

          <div className="flatlay__spin" ref={spin}>
            <div
              className="flatlay__label"
              style={
                {
                  left: `${labelInset}px`,
                  top: `${labelInset}px`,
                  width: `${RECORD.LABEL_RADIUS * 2}px`,
                  height: `${RECORD.LABEL_RADIUS * 2}px`,
                  '--hole-gap': `${RECORD.SPINDLE_RADIUS * 2 + 13}px`,
                } as CSSProperties
              }
            >
              {/* The small print, curved around the label the way a pressing
                  sets it. */}
              <svg className="flatlay__label-print" viewBox="0 0 200 200" aria-hidden>
                <defs>
                  {/* Left to right over the top, and right to left under the
                      bottom, so both read the right way up. */}
                  <path id="flatlay-arc-top" d="M 28 100 A 72 72 0 0 1 172 100" fill="none" />
                  <path id="flatlay-arc-foot" d="M 176 100 A 76 76 0 0 1 24 100" fill="none" />
                </defs>
                <text className="flatlay__label-arc">
                  <textPath href="#flatlay-arc-top" startOffset="50%" textAnchor="middle">
                    VUELTA · LONG PLAY · 16⅔ RPM
                  </textPath>
                </text>
                <text className="flatlay__label-arc">
                  <textPath href="#flatlay-arc-foot" startOffset="50%" textAnchor="middle">
                    {catalogueNumber(title)}
                  </textPath>
                </text>
              </svg>

              <span className="flatlay__label-code" />

              <div className="flatlay__label-text">
                <span className="flatlay__label-title">{title ?? 'No record'}</span>
                {artist ? <span className="flatlay__label-artist">{artist}</span> : null}
              </div>

              <div
                className="flatlay__hole"
                style={{
                  left: `${holeInset}px`,
                  top: `${holeInset}px`,
                  width: `${RECORD.SPINDLE_RADIUS * 2}px`,
                  height: `${RECORD.SPINDLE_RADIUS * 2}px`,
                }}
              />
            </div>
          </div>

          <div className="flatlay__sheen" />
        </div>

        {/* The sleeve. Paints after the record, and therefore over it. */}
        <div
          ref={sleeve}
          className={`flatlay__sleeve${slots.front ? '' : ' flatlay__sleeve--empty'}`}
          onClick={(event) => {
            event.stopPropagation()
            setCoverInFront((was) => !was)
          }}
          role="button"
          tabIndex={-1}
          aria-label="Send the cover behind the record, or bring it back in front"
          style={{
            left: `${SLEEVE.LEFT}px`,
            top: `${SLEEVE.TOP}px`,
            width: `${SLEEVE.SIZE}px`,
            height: `${SLEEVE.SIZE}px`,
            // From the constant rather than from the stylesheet, which carried
            // its own copy of the figure and had been drifting from it.
            borderRadius: `${SLEEVE.CORNER_RADIUS}px`,
          }}
        >
          {slots.back ? (
            <img className="flatlay__sleeve-art" src={slots.back} alt="" />
          ) : null}
          {slots.front ? (
            <img
              key={slots.front}
              className="flatlay__sleeve-art flatlay__sleeve-art--in"
              src={slots.front}
              alt=""
            />
          ) : (
            <span>No record</span>
          )}
        </div>

        {/* The arm. Above both objects, because it rests on them. */}
        <svg
          className="flatlay__arm"
          viewBox={`0 0 ${BOX.WIDTH} ${BOX.HEIGHT}`}
          width={BOX.WIDTH}
          height={BOX.HEIGHT}
          aria-hidden
        >
          <defs>
            {/* §6: a vertical gradient across the tube's width, to fake a
                cylinder. Not flat grey, and not dark. */}
            {/* The tube is the only light thing on the arm, and in the
                reference it is nearly white down its centre line. */}
            <linearGradient id="flatlay-tube" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#9a969b" />
              <stop offset="0.28" stopColor="#e8e6e8" />
              <stop offset="0.46" stopColor="#ffffff" />
              <stop offset="0.72" stopColor="#c2bec2" />
              <stop offset="1" stopColor="#7e7a7f" />
            </linearGradient>
          </defs>

          {/* Everything below travels with the record when it adjusts. */}
          <g ref={armShift}>

            <g className="flatlay__arm-lift" ref={armLift} data-lifted="true">
            <g
              ref={armGroup}
              transform={`rotate(${armBearingDeg(CORE_ARM.START_ANGLE)} ${PIVOT.x} ${PIVOT.y})`}
            >
              <g transform={`translate(${PIVOT.x} ${PIVOT.y})`}>
                {/* The tube, between the two cast collars it runs into. */}
                <rect
                  x={TUBE_START}
                  y={-ARM.TUBE_WIDTH / 2}
                  width={ARM.TUBE_LENGTH - TUBE_START}
                  height={ARM.TUBE_WIDTH}
                  rx={ARM.TUBE_WIDTH / 2}
                  fill="url(#flatlay-tube)"
                />

                {/* §6: the headshell, angled off the tube axis. The arm
                    visibly bends here, and the bend is in the geometry too --
                    its tip is exactly where the groove maths puts the stylus. */}
                <g
                  className="flatlay__arm-headshell"
                  transform={`rotate(${ARM.HEADSHELL_OFFSET_DEG} ${ARM_LOCAL.bend.x} 0)`}
                >
                  {/* The collar at the bend, which is what makes the joint
                      read as a fitting rather than as a kink in a line. */}
                  <rect
                    x={ARM_LOCAL.bend.x - 20}
                    y={-ARM.TUBE_WIDTH / 2 - 2.5}
                    width={26}
                    height={ARM.TUBE_WIDTH + 5}
                    rx={3}
                    fill="var(--arm-dark)"
                  />
                  <rect
                    x={ARM_LOCAL.bend.x - 2}
                    y={-ARM.HEADSHELL_WIDTH / 2}
                    width={ARM.HEADSHELL_LENGTH + 4}
                    height={ARM.HEADSHELL_WIDTH}
                    rx={8}
                    fill="var(--arm-dark)"
                    stroke="var(--arm-edge)"
                    strokeWidth={1}
                  />
                  {/* §6: the stylus — the point that maps to `armAngle`. A
                      stub off the shell's far corner, as the reference has it. */}
                  <rect
                    x={ARM_LOCAL.bend.x + ARM.HEADSHELL_LENGTH - 12}
                    y={ARM.HEADSHELL_WIDTH / 2 - 2}
                    width={17}
                    height={5}
                    rx={2.5}
                    fill="#2c2c33"
                    transform={`rotate(26 ${ARM_LOCAL.bend.x + ARM.HEADSHELL_LENGTH - 12} ${ARM.HEADSHELL_WIDTH / 2})`}
                  />
                </g>

                {/* The pivot assembly, in the reference's three pieces: the
                    column the tube comes out of, the counterweight beside it,
                    and a smaller block standing proud on top of that. */}
                <rect
                  x={-26}
                  y={-12}
                  width={48}
                  height={24}
                  rx={5}
                  fill="var(--arm-dark)"
                  stroke="var(--arm-edge)"
                  strokeWidth={1}
                />
                <rect
                  x={-36}
                  y={2}
                  width={40}
                  height={38}
                  rx={5}
                  fill="#1b1b20"
                  stroke="var(--arm-edge)"
                  strokeWidth={1}
                />
                {/* The band of light across it, running *across* the block
                    and so perpendicular to the tube — along the arm it reads
                    as a stripe down the casting instead, which is what it did
                    first. The reference's cast parts are not flat black, and
                    this is most of what says so. */}
                <rect
                  x={-32}
                  y={11}
                  width={6}
                  height={27}
                  rx={3}
                  fill="rgba(255,255,255,0.16)"
                />
                <rect
                  x={-31}
                  y={36}
                  width={30}
                  height={14}
                  rx={3}
                  fill="#26262d"
                  stroke="var(--arm-edge)"
                  strokeWidth={1}
                />

                {/* The grab target. Invisible, and far fatter than the tube it
                    wraps, because nine pixels is not a drag handle. It starts
                    clear of the housing so the two targets do not fight. */}
                <line
                  className="flatlay__arm-grab"
                  onClick={(event) => event.stopPropagation()}
                  x1={34}
                  y1={0}
                  x2={ARM_REACH}
                  y2={0}
                  stroke="rgba(0,0,0,0)"
                  strokeWidth={38}
                  strokeLinecap="round"
                  {...drag}
                />

                {/* The top of the arm — housing and counterweight — is the
                    play/pause control. It replaces the cue button that used
                    to sit beside the bearing: the gesture belongs on the arm
                    itself, where a cue lever is. Last in paint order, so it
                    takes the click before the drag target does. */}
                <circle
                  className="flatlay__arm-cue"
                  cx={0}
                  cy={0}
                  r={30}
                  fill="rgba(0,0,0,0)"
                  onClick={toggle}
                />
                </g>
              </g>
            </g>
          </g>
        </svg>

      </div>
    </div>
  )
}
