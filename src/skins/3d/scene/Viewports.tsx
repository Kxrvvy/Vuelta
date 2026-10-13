/**
 * Drawing the scene twice: the main frame, and the close-up view's inset.
 *
 * Two <Canvas> elements would have been the easy way and the wrong one -- two
 * WebGL contexts, two copies of every geometry and texture, two environment
 * maps to generate. Instead this renders one scene through two cameras into
 * two scissored regions of the same canvas, which is what the scissor test is
 * for.
 *
 * The price is that R3F stops rendering by itself. Any useFrame with a
 * priority above zero hands the render loop to the caller, so from here on
 * *every* frame in every view is drawn by this file. That is why it is mounted
 * always and not only in the close-up: a component that sometimes owns the
 * loop would leave the main view black the moment it unmounted.
 *
 * Ordering still works out. Callbacks run priority zero first, so Staging has
 * already flipped `shadowMap.needsUpdate` for this frame, and the first
 * gl.render consumes it -- one shadow pass per frame, as before, not one per
 * viewport.
 */

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo } from 'react'
import { PerspectiveCamera } from 'three'
import { CAMERA } from '../geometry/dimensions.js'
import { fitCamera, insetRect } from '../geometry/framing.js'
import { LAYER, maskFor } from '../layers.js'

export function Viewports({ inset }: { inset: boolean }) {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const raycaster = useThree((state) => state.raycaster)
  const size = useThree((state) => state.size)
  const invalidate = useThree((state) => state.invalidate)

  const insetCamera = useMemo(() => new PerspectiveCamera(CAMERA.FOV, 1, 0.05, 12), [])

  /**
   * Who sees what.
   *
   * The flat-lay drops the whole machine and gains a sleeve; the inset is the
   * machine and never the sleeve; every other view is the machine as it always
   * was. Three cameras, three masks.
   *
   * The raycaster follows the main camera, and that is not a nicety. Its
   * layers default to layer 0 alone, so moving the cabinet off that layer
   * would make it -- and the lid, the knob and the Open button with it --
   * unpickable in every view at once. Following the camera fixes that and
   * states the right rule anyway: what can be clicked is what can be seen. In
   * the flat-lay the machine is not there, so a click where it would have been
   * lands on the empty field, which is what dismisses the chrome.
   */
  useLayoutEffect(() => {
    const mainMask = inset
      ? maskFor(LAYER.COMMON, LAYER.FLATLAY)
      : maskFor(LAYER.COMMON, LAYER.MACHINE)
    camera.layers.mask = mainMask
    raycaster.layers.mask = mainMask
    insetCamera.layers.mask = maskFor(LAYER.COMMON, LAYER.MACHINE)
  }, [inset, camera, raycaster, insetCamera])

  // Appearing and disappearing is a change nothing else asks for a frame for.
  useEffect(() => invalidate(), [inset, invalidate])

  useFrame(() => {
    const { width, height } = size
    if (width <= 0 || height <= 0) return

    // Full frame, full clear, every time.
    //
    // The scissor rectangle is restored as well as the test, which is not
    // belt and braces: the inset leaves the rectangle set to its own corner,
    // and a clear that is still bounded by it leaves the rest of the canvas
    // holding the previous frame. That showed up as a ghost of the sleeve at
    // the camera's *old* distance after every switch into this view, sitting
    // there until something happened to redraw the whole canvas.
    gl.setScissorTest(false)
    gl.setViewport(0, 0, width, height)
    gl.setScissor(0, 0, width, height)
    gl.clear()
    gl.render(scene, camera)

    if (!inset) return

    const rect = insetRect(width, height)
    const framing = fitCamera({
      width: rect.width,
      height: rect.height,
      reserveRightPx: 0,
      pose: 'top',
    })

    insetCamera.aspect = rect.width / rect.height
    insetCamera.position.set(...framing.position)
    insetCamera.lookAt(framing.targetX, framing.targetY, 0)
    insetCamera.updateProjectionMatrix()

    // WebGL counts from the bottom left; everything else here counts from the
    // top left, and the inset lives at the top.
    const bottom = height - rect.y - rect.height
    gl.setScissorTest(true)
    gl.setViewport(rect.x, bottom, rect.width, rect.height)
    gl.setScissor(rect.x, bottom, rect.width, rect.height)
    // autoClear is on, and with the scissor test enabled that clear is
    // confined to this rectangle -- which is what stops the inset's machine
    // being drawn on top of the main view.
    //
    // It clears to the same field as everything else, deliberately: the inset
    // had a card of its own for a while and it read as a panel stuck over the
    // scene. The machine sits on the same dark field the record does, and the
    // only thing marking the inset out is the machine itself.
    gl.render(scene, insetCamera)

    gl.setScissorTest(false)
    gl.setViewport(0, 0, width, height)
    gl.setScissor(0, 0, width, height)
  }, 1)

  return null
}
