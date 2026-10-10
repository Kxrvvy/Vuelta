/**
 * A synthetic RenderState driver, for developing the skin before M1 exists.
 *
 * M1 owns the real thing: polling, local extrapolation on rAF, reconciliation,
 * optimistic overrides. None of that is built yet, so nothing advances
 * `progressMs` and the arm would sit still.
 *
 * This stands in. It is deliberately the *shape* of what M1 will produce and
 * nothing more — a clock that advances progress and derives `armAngle` through
 * the real `core/armMath`. When M1 lands, the driver is replaced and the scene
 * does not change at all. That substitutability is the entire point of the
 * skin boundary.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { armAngleFor } from '../../../core/armMath.js'
import { ARM, INITIAL_RENDER_STATE, type RenderState } from '../../../core/contract.js'

const DEFAULT_DURATION = 210_000 // 3:30, the track length spec §10 reasons about

/** Readout refresh rate. The scene reads the ref at 60fps; the UI does not
 *  need to, and re-rendering React sixty times a second is exactly what
 *  CLAUDE.md forbids. */
const READOUT_HZ = 4

export type HarnessControls = {
  togglePlay(): void
  setProgress(ms: number): void
  setDuration(ms: number): void
  setAlbumArtUrl(url: string | null): void
  toggleLid(): void
  restart(): void
}

export type HarnessReadout = {
  progressMs: number
  durationMs: number
  isPlaying: boolean
  armAngle: number
  lidOpen: boolean
}

export function useSyntheticState(): {
  stateRef: { current: RenderState }
  readout: HarnessReadout
  albumArtUrl: string | null
  active: boolean
  controls: HarnessControls
} {
  const stateRef = useRef<RenderState>({
    ...INITIAL_RENDER_STATE,
    durationMs: DEFAULT_DURATION,
    armAngle: ARM.REST_ANGLE,
    // The reference photographs are all lid-open, and so is the interesting view.
    lidOpen: true,
  })

  // Structural values that genuinely should re-render React.
  const [albumArtUrl, setAlbumArt] = useState<string | null>(null)
  const [active, setActive] = useState(false)
  const [readout, setReadout] = useState<HarnessReadout>({
    progressMs: 0,
    durationMs: DEFAULT_DURATION,
    isPlaying: false,
    armAngle: ARM.REST_ANGLE,
    lidOpen: true,
  })

  // The clock. One module owns progressMs — here, that is this loop, standing
  // in for M1's clock module.
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let lastReadout = 0

    const tick = (now: number) => {
      const delta = now - last
      last = now
      const state = stateRef.current

      if (state.isPlaying && !state.isDragging) {
        state.progressMs = Math.min(state.progressMs + delta, state.durationMs)
        if (state.progressMs >= state.durationMs) state.isPlaying = false
      }

      state.armAngle = state.isPlaying
        ? armAngleFor(state.progressMs, state.durationMs)
        : ARM.REST_ANGLE
      state.platterRpm = state.isPlaying ? 100 / 3 : 0

      if (now - lastReadout > 1000 / READOUT_HZ) {
        lastReadout = now
        setReadout({
          progressMs: state.progressMs,
          durationMs: state.durationMs,
          isPlaying: state.isPlaying,
          armAngle: state.armAngle,
          lidOpen: state.lidOpen,
        })
        setActive(state.isPlaying || state.platterRpm > 0)
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const nudge = useCallback(() => setActive(true), [])

  const controls: HarnessControls = {
    togglePlay: useCallback(() => {
      const state = stateRef.current
      state.isPlaying = !state.isPlaying
      if (state.isPlaying && state.progressMs >= state.durationMs) state.progressMs = 0
      nudge()
    }, [nudge]),

    setProgress: useCallback(
      (ms: number) => {
        const state = stateRef.current
        state.progressMs = Math.max(0, Math.min(ms, state.durationMs))
        state.armAngle = armAngleFor(state.progressMs, state.durationMs)
        nudge()
      },
      [nudge],
    ),

    setDuration: useCallback(
      (ms: number) => {
        const state = stateRef.current
        state.durationMs = Math.max(1000, ms)
        state.progressMs = Math.min(state.progressMs, state.durationMs)
        nudge()
      },
      [nudge],
    ),

    setAlbumArtUrl: useCallback((url: string | null) => {
      stateRef.current.albumArtUrl = url
      setAlbumArt(url)
    }, []),

    toggleLid: useCallback(() => {
      stateRef.current.lidOpen = !stateRef.current.lidOpen
      nudge()
    }, [nudge]),

    restart: useCallback(() => {
      const state = stateRef.current
      state.progressMs = 0
      state.armAngle = armAngleFor(0, state.durationMs)
      nudge()
    }, [nudge]),
  }

  return { stateRef, readout, albumArtUrl, active, controls }
}
