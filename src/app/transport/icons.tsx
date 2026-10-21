/**
 * Transport icons, drawn rather than typed.
 *
 * These were the glyphs ⏮ ⏸ ▶ ⏭. A glyph's box can sit dead centre in its
 * button while the mark inside it does not: measured off the rendered pixels,
 * ⏮ and ⏭ sat about 1.9px low in the now-playing panel, because the ink of a
 * symbol glyph is placed against a baseline and not against the middle of its
 * line box. Nothing in CSS centres ink; it centres boxes.
 *
 * Drawn, the geometry is ours, and the one correction that cannot be derived
 * can be made deliberately — see `Play`.
 *
 * Each icon is a 24×24 viewBox with the mark centred on (12, 12), so dropping
 * one into any `place-items: center` button lands it correctly at any size.
 */

const box = {
  viewBox: '0 0 24 24',
  /* The marks occupy about half their viewBox, so 1em of svg draws a mark
     half the size of the glyph it replaced. Sized against the ink, not the
     box: this lands them where ⏮ ▶ ⏭ were. */
  width: '1.65em',
  height: '1.65em',
  fill: 'currentColor',
  'aria-hidden': true,
} as const

/**
 * A right-pointing triangle centred on its bounding box reads as left-heavy,
 * because its area is gathered at the base: the centroid sits a third of the
 * way from the base, not half. So the mark is centred first, then nudged right
 * by an eighth of its own width to put the *weight* on the centre line rather
 * than the outline.
 *
 * Two steps, because doing it in one got it wrong: the triangle was drawn from
 * 7.4 to 19 in a 24 box, which is already 1.2 right of centre, and the nudge
 * went on top of that for a total of 2.6 — over twice what was wanted. Centre
 * the shape, then offset it.
 */
const PLAY_WIDTH = 11.6
const PLAY_NUDGE = PLAY_WIDTH / 8
const PLAY_LEFT = 12 - PLAY_WIDTH / 2 + PLAY_NUDGE

export function Play() {
  return (
    <svg {...box}>
      <path
        d={`M${PLAY_LEFT} 4.9 L${PLAY_LEFT + PLAY_WIDTH} 12 L${PLAY_LEFT} 19.1 Z`}
      />
    </svg>
  )
}

export function Pause() {
  return (
    <svg {...box}>
      <rect x="7" y="5" width="3.6" height="14" rx="1.1" />
      <rect x="13.4" y="5" width="3.6" height="14" rx="1.1" />
    </svg>
  )
}

export function Previous() {
  return (
    <svg {...box}>
      <rect x="5.6" y="5.5" width="2.4" height="13" rx="1" />
      <path d="M18.4 5.9 L18.4 18.1 L9.2 12 Z" />
    </svg>
  )
}

export function Next() {
  return (
    <svg {...box}>
      <path d="M5.6 5.9 L5.6 18.1 L14.8 12 Z" />
      <rect x="16" y="5.5" width="2.4" height="13" rx="1" />
    </svg>
  )
}
