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
 * Skip keeps a home at the foot. It has no gesture on a turntable, and this
 * view is the one that takes the panel's buttons away.
 */

import { useEffect, useRef, useState } from 'react'
import type { Actions, RenderState, TrackSummary } from '../../core/contract.js'
import { activeLyricIndex, type LyricLine } from '../../core/lyrics.js'
import type { LyricsLoad } from './useLyrics.js'

export function LyricsColumn({
  ref,
  load,
  track,
  isPlaying,
  stateRef,
  actions,
}: {
  /** Measured by the stage so the camera can frame beside it. */
  ref?: React.Ref<HTMLElement>
  load: LyricsLoad
  track: TrackSummary | null
  isPlaying: boolean
  /** Live progress, read per frame. Never a prop that changes per frame. */
  stateRef: React.RefObject<RenderState>
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

  return (
    <aside className="lyrics" ref={ref}>
      <header className="lyrics__head">
        <div className="lyrics__title">{track?.title ?? 'Nothing playing'}</div>
        <div className="lyrics__artist">{track?.artist ?? '—'}</div>
      </header>

      <div className="lyrics__body" ref={scroller}>
        <Body load={load} index={index} activeRef={active} lines={lines} />
      </div>

      <div className="lyrics__transport">
        <button type="button" aria-label="Previous track" onClick={() => actions.previous()}>
          ⏮
        </button>
        <button
          type="button"
          className="primary"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          onClick={() => (isPlaying ? actions.pause() : actions.play())}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button type="button" aria-label="Next track" onClick={() => actions.next()}>
          ⏭
        </button>
      </div>
    </aside>
  )
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
        >
          {/* A sung-less gap still takes a line, so the column keeps moving
              through a long instrumental break instead of appearing stuck. */}
          {line.text || '♪'}
        </p>
      ))}
    </>
  )
}
