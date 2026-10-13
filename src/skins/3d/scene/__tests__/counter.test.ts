import { describe, expect, it } from 'vitest'

import { BLINK_PERIOD_MS, displayState, redrawKey } from '../counter.js'

const at = (over: Partial<Parameters<typeof displayState>[0]> = {}) =>
  displayState({ progressMs: 0, durationMs: 210_000, isPlaying: true, nowMs: 0, ...over })

describe('what the counter reads', () => {
  it('formats elapsed and total as a clock', () => {
    const state = at({ progressMs: 83_000, durationMs: 225_000 })
    expect(state.elapsed).toBe('1:23')
    expect(state.total).toBe('3:45')
  })

  it('gives zero rather than NaN when nothing is playing', () => {
    // The live state every time the app starts, and on every NO_DEVICE poll.
    // A duration of zero divided into a progress of zero is the obvious way
    // to put NaN on screen.
    const state = at({ progressMs: 0, durationMs: 0, isPlaying: false })
    expect(state.fraction).toBe(0)
    expect(Number.isNaN(state.fraction)).toBe(false)
    expect(state.elapsed).toBe('0:00')
    expect(state.total).toBe('0:00')
  })

  it('survives a duration that is absent or nonsense', () => {
    for (const durationMs of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      const state = at({ durationMs })
      expect(Number.isFinite(state.fraction)).toBe(true)
      expect(state.fraction).toBeGreaterThanOrEqual(0)
      expect(state.fraction).toBeLessThanOrEqual(1)
    }
  })
})

describe('the progress fraction', () => {
  it('tracks position through the track', () => {
    expect(at({ progressMs: 105_000, durationMs: 210_000 }).fraction).toBeCloseTo(0.5, 10)
  })

  it('clamps past the end instead of overflowing the bar', () => {
    // The local clock keeps running between polls, so it routinely reads a
    // little past the end before the next track is reported.
    expect(at({ progressMs: 260_000, durationMs: 210_000 }).fraction).toBe(1)
  })

  it('clamps below zero, which a drag can reach', () => {
    expect(at({ progressMs: -5_000 }).fraction).toBe(0)
    expect(at({ progressMs: -5_000 }).elapsed).toBe('0:00')
  })
})

describe('the paused blink', () => {
  it('holds the colon steady while playing', () => {
    for (let nowMs = 0; nowMs < 4000; nowMs += 120) {
      expect(at({ isPlaying: true, nowMs }).colonLit).toBe(true)
    }
  })

  it('alternates once a second while paused', () => {
    const lit = (nowMs: number) => at({ isPlaying: false, nowMs }).colonLit
    expect(lit(0)).toBe(true)
    expect(lit(BLINK_PERIOD_MS / 4)).toBe(true)
    expect(lit(BLINK_PERIOD_MS / 2)).toBe(false)
    expect(lit(BLINK_PERIOD_MS - 1)).toBe(false)
    // And it repeats rather than running off.
    expect(lit(BLINK_PERIOD_MS * 7)).toBe(true)
    expect(lit(BLINK_PERIOD_MS * 7.75)).toBe(false)
  })

  it('spends equal time lit and dark', () => {
    let on = 0
    const steps = 400
    for (let i = 0; i < steps; i++) {
      if (at({ isPlaying: false, nowMs: (i * BLINK_PERIOD_MS * 3) / steps }).colonLit) on++
    }
    expect(on / steps).toBeCloseTo(0.5, 1)
  })
})

describe('the redraw key', () => {
  it('ignores changes too small to paint', () => {
    // The whole point: a progress change that does not move the bar by a
    // pixel must not cost a texture upload.
    const a = at({ progressMs: 100_000, durationMs: 210_000 })
    const b = at({ progressMs: 100_050, durationMs: 210_000 })
    expect(redrawKey(a, 480)).toBe(redrawKey(b, 480))
  })

  it('changes when the second ticks over', () => {
    const a = at({ progressMs: 100_000 })
    const b = at({ progressMs: 101_000 })
    expect(redrawKey(a, 480)).not.toBe(redrawKey(b, 480))
  })

  it('changes when the bar moves a pixel', () => {
    const a = at({ progressMs: 100_000, durationMs: 210_000 })
    const b = at({ progressMs: 100_500, durationMs: 210_000 })
    expect(redrawKey(a, 480)).not.toBe(redrawKey(b, 480))
  })

  it('changes when the colon blinks, so the blink actually repaints', () => {
    const lit = at({ isPlaying: false, nowMs: 0 })
    const dark = at({ isPlaying: false, nowMs: BLINK_PERIOD_MS / 2 })
    expect(redrawKey(lit, 480)).not.toBe(redrawKey(dark, 480))
  })
})
