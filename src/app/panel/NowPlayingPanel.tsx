/**
 * The now-playing panel — spec §11.
 *
 * Everything the turntable cannot express by itself: what is playing, and
 * skip, which has no natural gesture on a record player.
 *
 * Whether it is on screen is not its own decision: TopView summons it, on a
 * click that lands anywhere outside the machine, and dismisses it the same
 * way. Spec §13 is right that always-visible chrome fights the illusion of an
 * object sitting on your desk, and chrome that appears whenever the cursor
 * crosses the window, which is what this used to do, is always-visible in
 * practice. It is an overlay rather than a column, so the turntable never
 * shifts position when it appears.
 */

import { useRef } from 'react'
import type { Actions, TrackSummary } from '../../core/contract.js'
import { mmss } from '../../core/format.js'
import { Next, Pause, Play, Previous } from '../transport/icons.js'

export function NowPlayingPanel({
  ref,
  track,
  progressMs,
  durationMs,
  isPlaying,
  volumePercent,
  deviceName,
  actions,
  visible,
}: {
  /** Measured by TopView so the camera can frame around the panel. */
  ref?: React.Ref<HTMLElement>
  track: TrackSummary | null
  progressMs: number
  durationMs: number
  isPlaying: boolean
  volumePercent: number | null
  deviceName: string | null
  actions: Actions
  visible: boolean
}) {
  const volume = volumePercent ?? 50

  return (
    <aside
      ref={ref}
      className="panel"
      data-visible={visible ? 'true' : 'false'}
      // Hidden from the pointer when faded out, so it cannot swallow a click
      // meant for the record underneath it.
      style={{ pointerEvents: visible ? 'auto' : 'none' }}
    >
      <div className="panel__art">
        {track?.albumArtUrl ? (
          <img src={track.albumArtUrl} alt="" draggable={false} />
        ) : (
          <div className="panel__art--empty" />
        )}
      </div>

      <div className="panel__meta">
        <div className="panel__title">{track?.title ?? 'Nothing playing'}</div>
        <div className="panel__artist">{track?.artist ?? '—'}</div>
      </div>

      <div className="panel__time">
        {mmss(progressMs)} / {mmss(durationMs)}
      </div>

      <div className="panel__transport">
        <button type="button" aria-label="Previous track" onClick={() => actions.previous()}>
          <Previous />
        </button>
        <button
          type="button"
          className="primary"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          onClick={() => (isPlaying ? actions.pause() : actions.play())}
        >
          {isPlaying ? <Pause /> : <Play />}
        </button>
        <button type="button" aria-label="Next track" onClick={() => actions.next()}>
          <Next />
        </button>
      </div>

      <PanelKnob value={volume} onChange={(next) => actions.setVolume(next)} />

      {deviceName ? <div className="panel__device">{deviceName}</div> : null}
    </aside>
  )
}

/**
 * A full-size mirror of the cabinet's knob. Same gesture — click and hold,
 * slide horizontally — because at the top-down camera angle the real one is
 * roughly a 20×10 pixel target.
 */
function PanelKnob({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  const dragging = useRef(false)
  const grabX = useRef(0)
  const grabValue = useRef(0)

  const begin = (event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true
    grabX.current = event.clientX
    grabValue.current = value
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    const travelled = event.clientX - grabX.current
    onChange(Math.max(0, Math.min(100, grabValue.current + (travelled / 180) * 100)))
  }

  const end = (event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div className="panel__volume">
      <div
        className="knob"
        role="slider"
        tabIndex={0}
        aria-label="Volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value)}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onWheel={(event) => onChange(Math.max(0, Math.min(100, value - Math.sign(event.deltaY) * 4)))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') onChange(Math.max(0, value - 4))
          if (event.key === 'ArrowRight') onChange(Math.min(100, value + 4))
        }}
      >
        <div
          className="knob__pointer"
          style={{ transform: `rotate(${(value / 100 - 0.5) * 270}deg)` }}
        />
      </div>
      <span className="panel__volume-value">{Math.round(value)}</span>
    </div>
  )
}
