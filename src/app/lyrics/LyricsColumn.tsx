/**
 * The lyrics column.
 *
 * Its own column beside the machine, not chrome hanging off the browser bar:
 * in this view the machine sits to the left and the lyrics hold the right
 * edge, in place of the now-playing panel. It reserves its width through the
 * same measurement the panel uses, so the camera frames the machine into
 * what is left rather than behind it.
 *
 * The line lights up half a second before it is sung and goes out as the next
 * one leads in. That rule is core/lyrics.ts; here it is only a class name and
 * a CSS transition.
 *
 * The words and nothing else. It had a title, an artist and a transport of its
 * own, and a card to hold them; all of it is gone, so the lyrics stand on the
 * field with no edge around them. Play and pause still have a home in this
 * view -- the machine is right there, and the disc is the control -- but skip
 * no longer does, which is the price of the bare column.
 */

import { useEffect, useRef, useState } from 'react'
import type { Actions, RenderState } from '../../core/contract.js'
import { activeLyricIndex, type LyricLine } from '../../core/lyrics.js'
import type { LyricsLoad } from './useLyrics.js'
import { Next, Previous } from '../transport/icons.js'

export function LyricsColumn({
  ref,
  load,
  stateRef,
  actions,
}: {
  /** Measured by the stage so the camera can frame beside it. */
  ref?: React.Ref<HTMLElement>
  load: LyricsLoad
  /** Live progress, read per frame. Never a prop that changes per frame. */
  stateRef: React.RefObject<RenderState>
  /** Only skip, and only on the empty state -- see the note below the body. */
  actions: Actions
}) {
  const lines = load.status === 'ready' ? (load.value?.lines ?? []) : []
  const [index, setIndex] = useState(-1)
  const shown = useRef(-1)
  const scroller = useRef<HTMLDivElement | null>(null)
  const active = useRef<HTMLParagraphElement | null>(null)

  // Which line is current, resolved from the live clock rather than from
  // `sync.readout` -- that refreshes at READOUT_HZ, four times a second, which
  // would land every line up to 250ms late and make the lead-in pointless.
  //
  // setState happens only when the index actually changes, so this costs one
  // render per sung line and not one per frame. Same discipline as the deck
  // counter's redraw key.
  //
  // It keeps running while paused, which is deliberate: pause leaves the arm
  // draggable, so progress can still move while nothing is playing. The frame
  // does a scan of a few hundred lines and a comparison, and draws nothing.
  useEffect(() => {
    shown.current = -1
    if (lines.length === 0) {
      setIndex(-1)
      return
    }

    let raf = 0
    const frame = () => {
      const next = activeLyricIndex(lines, stateRef.current.progressMs)
      if (next !== shown.current) {
        shown.current = next
        setIndex(next)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [lines, stateRef])

  // Keep the sung line in the middle of the column. `scrollTo` rather than
  // `scrollIntoView`, which would also scroll the window behind it.
  const previous = useRef(-1)
  useEffect(() => {
    const box = scroller.current
    const line = active.current
    const from = previous.current
    previous.current = index
    if (!box || !line) return

    // Smooth for the ordinary step from one line to the next. A jump -- the
    // view opening part-way through a song, or a seek -- goes straight there:
    // a smooth scroll across twenty lines is a long slide that arrives after
    // the line it was chasing has already been sung.
    const step = Math.abs(index - from) <= 2 && from >= 0
    box.scrollTo({
      top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2,
      behavior: step ? 'smooth' : 'auto',
    })
  }, [index])

  const mode = bodyMode(load, lines)

  return (
    <aside className="lyrics" ref={ref}>
      <div className="lyrics__body" data-mode={mode} ref={scroller}>
        <Body load={load} index={index} activeRef={active} lines={lines} />

        {/* Skip, under the message and only there.
            Stripping the column of its transport cost this view its only
            previous and next -- play and pause survived it, because the
            machine is beside this column and the disc is the control, but
            skip had nowhere else to go. The empty state is exactly where it
            is wanted and exactly where there is room: a column with no words
            in it is a column you want to move on from. With lyrics up, the
            words have the space and nothing is drawn over them. */}
        {mode === 'note' ? (
          <div className="lyrics__skip">
            <button type="button" aria-label="Previous track" onClick={() => actions.previous()}>
              <Previous />
            </button>
            <button type="button" aria-label="Next track" onClick={() => actions.next()}>
              <Next />
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  )
}

/**
 * What the body is showing, which is what decides how it is laid out.
 *
 * `lines` and `plain` both scroll and both want the half-column of air that
 * lets the first and last lines reach the middle. A note is one sentence with
 * nothing to follow, so it is centred instead -- left where the first lyric
 * would have gone, it reads as a column that failed to load rather than as an
 * answer.
 */
function bodyMode(load: LyricsLoad, lines: LyricLine[]): 'lines' | 'plain' | 'note' {
  if (load.status !== 'ready') return 'note'
  if (!load.value || load.value.instrumental) return 'note'
  if (lines.length > 0) return 'lines'
  return load.value.plain ? 'plain' : 'note'
}

function Body({
  load,
  lines,
  index,
  activeRef,
}: {
  load: LyricsLoad
  lines: LyricLine[]
  index: number
  activeRef: React.RefObject<HTMLParagraphElement | null>
}) {
  if (load.status === 'idle' || load.status === 'loading') {
    return <p className="lyrics__note">Looking for lyrics…</p>
  }
  if (load.status === 'error') return <p className="lyrics__note">{load.message}</p>

  // A miss is the ordinary case for plenty of tracks, so it reads as a fact
  // rather than as a failure.
  if (!load.value) return <p className="lyrics__note">No lyrics for this track.</p>
  if (load.value.instrumental) return <p className="lyrics__note">Instrumental.</p>

  if (lines.length === 0) {
    // Found, but with no timings. Better than nothing, and honest about not
    // following the song.
    if (load.value.plain) {
      return (
        <>
          <p className="lyrics__note">Not synced — these do not follow the song.</p>
          <p className="lyrics__plain">{load.value.plain}</p>
        </>
      )
    }
    return <p className="lyrics__note">No lyrics for this track.</p>
  }

  return (
    <>
      {lines.map((line, at) => (
        <p
          key={`${line.atMs}-${at}`}
          ref={at === index ? activeRef : undefined}
          className="lyrics__line"
          data-state={at === index ? 'now' : at < index ? 'past' : 'ahead'}
          // How far this line is from the one being sung. The fade is graded
          // by it rather than being one value for "not now": the lines either
          // side of the vocal stay readable and the column falls away from
          // there, which is what makes the middle of it read as the present.
          style={{ '--d': index < 0 ? 6 : Math.abs(at - index) } as React.CSSProperties}
        >
          {/* A sung-less gap still takes a line, so the column keeps moving
              through a long instrumental break instead of appearing stuck. */}
          {line.text || '♪'}
        </p>
      ))}
    </>
  )
}
