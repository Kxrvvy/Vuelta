/**
 * Keeps the camera framed on the machine as the window changes.
 *
 * All the arithmetic lives in geometry/framing.ts; this is the part that has
 * to touch three.js and React. Two hazards it exists to handle, both about
 * minimising:
 *
 *   · A minimised window reports a 0 × 0 canvas. framing.ts guards its own
 *     divisions, but there is no point refitting to a window nobody can see,
 *     so those frames are skipped entirely.
 *
 *   · `frameloop` drops to "demand" when nothing is moving. Restoring a
 *     minimised window would then leave whatever was last drawn — at the old
 *     size — or nothing at all. Every refit therefore ends with invalidate(),
 *     and visibility changes force one too.
 */

import { useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect } from 'react'
import { fitCamera } from '../geometry/framing.js'

export function CameraRig({ reserveRightPx }: { reserveRightPx: number }) {
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const invalidate = useThree((state) => state.invalidate)

  // Layout effect, not effect: this must land before the browser paints, or
  // the first frame after a resize shows the old framing.
  useLayoutEffect(() => {
    if (size.width <= 0 || size.height <= 0) return

    const framing = fitCamera({
      width: size.width,
      height: size.height,
      reserveRightPx,
    })

    camera.position.set(...framing.position)
    camera.lookAt(framing.targetX, 0, 0)
    camera.updateProjectionMatrix()
    invalidate()
  }, [camera, size.width, size.height, reserveRightPx, invalidate])

  useEffect(() => {
    const redraw = () => invalidate()
    document.addEventListener('visibilitychange', redraw)
    window.addEventListener('focus', redraw)
    return () => {
      document.removeEventListener('visibilitychange', redraw)
      window.removeEventListener('focus', redraw)
    }
  }, [invalidate])

  return null
}
