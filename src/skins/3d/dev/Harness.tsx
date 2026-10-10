/**
 * Development harness for the 3D skin.
 *
 * Dev-only: `App.tsx` guards it behind `import.meta.env.DEV`, so it is tree-
 * shaken out of production builds entirely.
 *
 * Everything below the canvas is scaffolding. The canvas itself is the real
 * skin, receiving exactly the RenderState it will receive from the store once
 * M1 exists.
 */

import { Turntable } from '../Turntable.js'
import { useSyntheticState } from './useSyntheticState.js'

function mmss(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`
}

const SAMPLE_ART = 'https://i.scdn.co/image/ab67616d0000b273926f43e7cce571e62720fd46'

export function Harness({ onExit }: { onExit: () => void }) {
  const { stateRef, readout, albumArtUrl, active, controls } = useSyntheticState()

  return (
    <div style={{ height: '100%', display: 'grid', gridTemplateRows: '1fr auto' }}>
      <div style={{ minHeight: 0, position: 'relative' }}>
        <Turntable state={stateRef} albumArtUrl={albumArtUrl} active={active} />
      </div>

      <div
        style={{
          display: 'grid',
          gap: '0.6rem',
          padding: '0.85rem 1.1rem',
          borderTop: '1px solid var(--line)',
          background: 'var(--panel)',
          fontSize: '0.85rem',
        }}
      >
        <div className="row" style={{ gap: '0.75rem' }}>
          <button type="button" className="primary" onClick={controls.togglePlay}>
            {readout.isPlaying ? 'Pause' : 'Play'}
          </button>
          <button type="button" onClick={controls.restart}>
            Restart
          </button>
          <button type="button" onClick={controls.toggleLid}>
            {readout.lidOpen ? 'Close lid' : 'Open lid'}
          </button>
          <button
            type="button"
            onClick={() => controls.setAlbumArtUrl(albumArtUrl ? null : SAMPLE_ART)}
          >
            {albumArtUrl ? 'Clear art' : 'Load album art'}
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" className="link" onClick={onExit}>
            Back
          </button>
        </div>

        <label className="row" style={{ gap: '0.75rem' }}>
          <span style={{ color: 'var(--muted)', minWidth: '4.5rem' }}>Progress</span>
          <input
            type="range"
            min={0}
            max={readout.durationMs}
            step={250}
            value={readout.progressMs}
            onChange={(event) => controls.setProgress(Number(event.target.value))}
            style={{ flex: 1 }}
          />
          <code style={{ minWidth: '7rem', textAlign: 'right' }}>
            {mmss(readout.progressMs)} / {mmss(readout.durationMs)}
          </code>
        </label>

        <div className="row" style={{ gap: '0.75rem', color: 'var(--muted)' }}>
          <span style={{ minWidth: '4.5rem' }}>Duration</span>
          {[120_000, 210_000, 420_000].map((ms) => (
            <button key={ms} type="button" onClick={() => controls.setDuration(ms)}>
              {mmss(ms)}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <code>armAngle {readout.armAngle.toFixed(2)}°</code>
        </div>
      </div>
    </div>
  )
}
