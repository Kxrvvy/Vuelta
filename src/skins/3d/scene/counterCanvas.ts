/**
 * Painting the deck counter.
 *
 * Separated from the component so the drawing is callable on its own — the
 * scene only renders once Spotify has an active device, and the segment
 * shapes, the ghosting and the bar are all checkable long before that.
 *
 * Real seven-segment shapes rather than text in a square typeface. Unlit
 * segments are painted too, very faintly: that ghosting is most of what makes
 * a display read as segmented, and without it the digits look like a font
 * pretending to be one.
 */

import type { DisplayState } from './counter.js'

/** Matches the panel's 58 x 22mm aspect, so nothing is stretched. */
export const TEX_W = 512
export const TEX_H = 192

const PAD_X = 16
const DIGIT_W = 48
const DIGIT_H = 100
const DIGIT_TOP = 28
const STROKE = 11
const CHAR_GAP = 7
const COLON_W = 18
const SLASH_W = 30
const SPACE_W = 12

const BAR_TOP = 144
const BAR_H = 20

const AMBER = '#ffb02e'
const GHOST = 'rgba(255,176,46,0.065)'
const TRACK = 'rgba(255,176,46,0.26)'
const GLASS = '#0a0806'

/** The bar's fillable span, and so the quantiser the redraw key rounds to. */
export const BAR_PIXELS = TEX_W - PAD_X * 2

/**
 * Which of the seven segments each digit lights.
 *
 *    aaa
 *   f   b
 *    ggg
 *   e   c
 *    ddd
 */
const SEGMENTS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abdeg',
  '3': 'abcdg',
  '4': 'bcfg',
  '5': 'acdfg',
  '6': 'acdefg',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
}

/** A segment as a tapered bar, which is the shape a real one has. */
function bar(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  length: number,
  vertical: boolean,
): void {
  const t = STROKE / 2
  context.beginPath()
  if (vertical) {
    context.moveTo(x, y)
    context.lineTo(x + t, y + t)
    context.lineTo(x + t, y + length - t)
    context.lineTo(x, y + length)
    context.lineTo(x - t, y + length - t)
    context.lineTo(x - t, y + t)
  } else {
    context.moveTo(x, y)
    context.lineTo(x + t, y - t)
    context.lineTo(x + length - t, y - t)
    context.lineTo(x + length, y)
    context.lineTo(x + length - t, y + t)
    context.lineTo(x + t, y + t)
  }
  context.closePath()
  context.fill()
}

function drawDigit(context: CanvasRenderingContext2D, char: string, x: number, y: number): void {
  const lit = SEGMENTS[char] ?? ''
  const w = DIGIT_W
  const h = DIGIT_H
  const half = h / 2

  const places: [string, () => void][] = [
    ['a', () => bar(context, x, y + STROKE / 2, w, false)],
    ['b', () => bar(context, x + w - STROKE / 2, y, half, true)],
    ['c', () => bar(context, x + w - STROKE / 2, y + half, half, true)],
    ['d', () => bar(context, x, y + h - STROKE / 2, w, false)],
    ['e', () => bar(context, x + STROKE / 2, y + half, half, true)],
    ['f', () => bar(context, x + STROKE / 2, y, half, true)],
    ['g', () => bar(context, x, y + half, w, false)],
  ]

  for (const [name, draw] of places) {
    const on = lit.includes(name)
    context.fillStyle = on ? AMBER : GHOST
    context.shadowBlur = on ? 9 : 0
    context.shadowColor = on ? AMBER : 'transparent'
    draw()
  }
  context.shadowBlur = 0
}

function charWidth(char: string): number {
  if (char === ':') return COLON_W
  if (char === '/') return SLASH_W
  if (char === ' ') return SPACE_W
  return DIGIT_W
}

function drawColon(context: CanvasRenderingContext2D, x: number, y: number, on: boolean): void {
  context.fillStyle = on ? AMBER : GHOST
  context.shadowBlur = on ? 8 : 0
  context.shadowColor = on ? AMBER : 'transparent'
  // Noticeably fatter than half a stroke. The panel renders about a fifth of
  // the texture's width, and at dot-sized radius the colons minified away to
  // nothing - which is most of what makes a time readable as a time.
  for (const cy of [y + DIGIT_H * 0.3, y + DIGIT_H * 0.7]) {
    context.beginPath()
    context.arc(x + COLON_W / 2, cy, STROKE * 0.78, 0, Math.PI * 2)
    context.fill()
  }
  context.shadowBlur = 0
}

function drawSlash(context: CanvasRenderingContext2D, x: number, y: number): void {
  // Dimmer than the digits: a separator, not a value.
  context.strokeStyle = 'rgba(255,176,46,0.62)'
  context.lineWidth = STROKE * 0.95
  context.lineCap = 'round'
  context.beginPath()
  context.moveTo(x + SLASH_W * 0.75, y + DIGIT_H * 0.12)
  context.lineTo(x + SLASH_W * 0.25, y + DIGIT_H * 0.88)
  context.stroke()
}

/** `null` paints the dark panel: the lid is shut and the machine is stopped. */
export function paintCounter(
  context: CanvasRenderingContext2D,
  state: DisplayState | null,
): void {
  context.clearRect(0, 0, TEX_W, TEX_H)
  context.fillStyle = GLASS
  context.fillRect(0, 0, TEX_W, TEX_H)

  if (!state) return

  const text = `${state.elapsed} / ${state.total}`
  let total = 0
  for (const char of text) total += charWidth(char) + CHAR_GAP
  total -= CHAR_GAP

  // Shrink to fit rather than overflow. `1:23 / 3:45` leaves room to spare,
  // but both sides can reach two-digit minutes - a long mix or a symphony
  // movement gives `12:34 / 56:78`, which is wider than the canvas. Scaling
  // is far better than clipping digits off the ends.
  const available = TEX_W - PAD_X * 2
  const scale = Math.min(1, available / total)

  context.save()
  context.translate(TEX_W / 2, DIGIT_TOP + DIGIT_H / 2)
  context.scale(scale, scale)
  context.translate(-total / 2, -DIGIT_H / 2)

  let x = 0
  for (const char of text) {
    if (char === ':') drawColon(context, x, 0, state.colonLit)
    else if (char === '/') drawSlash(context, x, 0)
    else if (char !== ' ') drawDigit(context, char, x, 0)
    x += charWidth(char) + CHAR_GAP
  }
  context.restore()

  const radius = BAR_H / 2
  context.fillStyle = TRACK
  context.beginPath()
  context.roundRect(PAD_X, BAR_TOP, BAR_PIXELS, BAR_H, radius)
  context.fill()

  const filled = Math.round(state.fraction * BAR_PIXELS)
  if (filled > 0) {
    context.fillStyle = AMBER
    context.shadowBlur = 11
    context.shadowColor = AMBER
    context.beginPath()
    // Never narrower than its own cap, or the rounded end renders as a wedge.
    context.roundRect(PAD_X, BAR_TOP, Math.max(filled, radius * 2), BAR_H, radius)
    context.fill()
    context.shadowBlur = 0
  }
}
