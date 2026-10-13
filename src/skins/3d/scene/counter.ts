/**
 * What the deck counter shows, decided before anything is drawn.
 *
 * Split out from the component so it can be tested without a canvas, a GPU or
 * a clock. Everything here is a pure function of its inputs — including the
 * blink, which is derived from the timestamp it is handed rather than kept as
 * state, so a test can step time instead of waiting for it.
 */

import { mmss } from '../../../core/format.js'

export type DisplayInput = {
  progressMs: number
  durationMs: number
  isPlaying: boolean
  /** Wall clock, only ever used to phase the paused blink. */
  nowMs: number
}

export type DisplayState = {
  elapsed: string
  total: string
  /** Position through the track, 0 to 1. Never NaN, never outside the range. */
  fraction: number
  /** False only on the dark half of the paused blink. */
  colonLit: boolean
}

/** A full on-off cycle of the colon while paused. */
export const BLINK_PERIOD_MS = 1000

export function displayState(input: DisplayInput): DisplayState {
  const { progressMs, durationMs, isPlaying, nowMs } = input

  const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0
  const progress = Number.isFinite(progressMs) ? Math.max(0, progressMs) : 0

  // A missing duration is the normal state whenever nothing is playing, so it
  // has to give 0 rather than a division by zero.
  const fraction = duration === 0 ? 0 : Math.min(1, progress / duration)

  return {
    elapsed: mmss(progress),
    total: mmss(duration),
    fraction,
    // Steady while playing. The blink is what distinguishes paused from
    // stopped on a real deck, and it is the only thing moving once the
    // platter has spun down.
    colonLit: isPlaying || !Number.isFinite(nowMs)
      ? true
      : nowMs % BLINK_PERIOD_MS < BLINK_PERIOD_MS / 2,
  }
}

/**
 * The string actually painted, used as the redraw key.
 *
 * The canvas is repainted only when this changes. Digits move once a second
 * and the bar by a pixel at a time, so comparing a short string is far cheaper
 * than redrawing a texture sixty times a second to produce the same image.
 *
 * The bar is quantised to its own pixel width for the same reason — a
 * fractional change too small to see is not worth a repaint.
 */
export function redrawKey(state: DisplayState, barPixels: number): string {
  const filled = Math.round(state.fraction * barPixels)
  return `${state.elapsed}|${state.total}|${filled}|${state.colonLit ? 1 : 0}`
}
