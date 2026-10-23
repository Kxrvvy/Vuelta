/**
 * The field every look stands on: the playing cover, blurred past recognition.
 *
 * One layer behind everything — behind the 3D canvas and behind the flat-lay
 * alike — rather than one per skin. The machine looks used to paint their own
 * field inside the three.js scene and the flat-lay painted its own in CSS, and
 * keeping two of those in step through every track change is a worse job than
 * having one. So the canvas is transparent now and the paper is too; this is
 * the only thing drawing a background in the app.
 *
 * At this blur the artwork is unreadable and only its colour survives, which
 * is the point: the room takes the record's colour without competing with the
 * sleeve for attention. Dimmed as well, so white chrome stays legible and the
 * cover stays the brightest thing on screen.
 *
 * Two layers, not one, because `background-image` does not transition. The
 * outgoing cover stays put while the incoming one fades over it, so a track
 * change is a dissolve rather than a cut.
 */

import { useEffect, useRef, useState } from 'react'

export function FieldBackdrop({ albumArtUrl }: { albumArtUrl: string | null }) {
  /** The cover being faded in. */
  const [current, setCurrent] = useState<string | null>(albumArtUrl)
  /** The one it is fading over, held until the fade is done. */
  const [previous, setPrevious] = useState<string | null>(null)
  const shown = useRef<string | null>(albumArtUrl)

  useEffect(() => {
    if (albumArtUrl === shown.current) return
    setPrevious(shown.current)
    setCurrent(albumArtUrl)
    shown.current = albumArtUrl

    // Drop the outgoing layer once it is wholly covered. Keeping it costs a
    // second full-window blur for the rest of the track, which is the most
    // expensive thing on screen.
    const done = window.setTimeout(() => setPrevious(null), FADE_MS + 120)
    return () => window.clearTimeout(done)
  }, [albumArtUrl])

  return (
    <div className="backdrop" aria-hidden>
      {previous ? (
        <div className="backdrop__art" style={{ backgroundImage: `url("${previous}")` }} />
      ) : null}
      {current ? (
        <div
          key={current}
          className="backdrop__art backdrop__art--in"
          style={{ backgroundImage: `url("${current}")` }}
        />
      ) : null}
    </div>
  )
}

/** Matches the animation in the stylesheet. */
const FADE_MS = 900
