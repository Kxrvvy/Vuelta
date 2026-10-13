/**
 * The digital counter set into the deck, at the front-left corner.
 *
 * Elapsed and total time over a progress track. Part of the machine rather
 * than chrome over it, which is the whole reason it exists — the now-playing
 * panel and the needle readout already show the same number, but both float
 * above the scene.
 *
 * This file is the mounting and the lifetime only. What it reads lives in
 * counter.ts and how it is painted in counterCanvas.ts, both pure and both
 * checkable without a GPU.
 */

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  CanvasTexture,
  Color,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  SRGBColorSpace,
} from 'three'
import { DISPLAY } from '../geometry/dimensions.js'
import { useRenderStateRef } from '../useFrameState.js'
import { BLINK_PERIOD_MS, displayState, redrawKey } from './counter.js'
import { BAR_PIXELS, paintCounter, TEX_H, TEX_W } from './counterCanvas.js'

export function TimeDisplay({ lidOpen }: { lidOpen: boolean }) {
  const stateRef = useRenderStateRef()
  const invalidate = useThree((state) => state.invalidate)
  const lastKey = useRef('')

  const { texture, context, material } = useMemo(() => {
    const element = document.createElement('canvas')
    element.width = TEX_W
    element.height = TEX_H
    const ctx = element.getContext('2d')
    if (!ctx) throw new Error('2D canvas context unavailable')

    paintCounter(ctx, null)

    // Not in the shared cache in materials/textures.ts: everything there is
    // immutable and disposed only at teardown. This one is rewritten as the
    // song plays, so it owns its own lifetime.
    const tex = new CanvasTexture(element)
    tex.colorSpace = SRGBColorSpace
    tex.magFilter = LinearFilter
    // Mipmapped on purpose, despite being rebuilt on every repaint. The panel
    // draws at roughly a fifth of the texture's width, and point-sampling a
    // minified seven-segment face is what turned the digits to mush. A repaint
    // happens about once a second, so the rebuild cost is nothing.
    tex.minFilter = LinearMipmapLinearFilter
    tex.generateMipmaps = true
    tex.anisotropy = 8

    return {
      texture: tex,
      context: ctx,
      material: new MeshStandardMaterial({
        map: tex,
        emissiveMap: tex,
        emissive: new Color('#ffffff'),
        // Dialled back from 1.5, where the amber blew out to cream. The map is
        // already the lit colour; the emissive only has to stop the panel
        // reading as a sticker.
        emissiveIntensity: 1.1,
        roughness: 0.28,
        metalness: 0,
      }),
    }
  }, [])

  useEffect(
    () => () => {
      texture.dispose()
      material.dispose()
    },
    [texture, material],
  )

  // The blink needs frames the render loop will not supply.
  //
  // `frameloop` drops to "demand" a couple of seconds after everything
  // settles, and `active` is false whenever playback is paused — which is
  // exactly when the colon is meant to be blinking. Without this the display
  // freezes mid-blink, and it looks correct right up until the scene goes
  // idle. Runs only with the lid open, and does nothing while playing, when
  // the loop is already turning.
  useEffect(() => {
    if (!lidOpen) return
    const timer = window.setInterval(() => {
      if (!stateRef.current.isPlaying) invalidate()
    }, BLINK_PERIOD_MS / 2)
    return () => window.clearInterval(timer)
  }, [lidOpen, invalidate, stateRef])

  useFrame(() => {
    const state = stateRef.current

    // Lid shut is the stop gesture, so the counter goes out with it.
    if (!lidOpen) {
      if (lastKey.current === 'dark') return
      lastKey.current = 'dark'
      paintCounter(context, null)
      texture.needsUpdate = true
      return
    }

    const shown = displayState({
      progressMs: state.progressMs,
      durationMs: state.durationMs,
      isPlaying: state.isPlaying,
      nowMs: Date.now(),
    })

    // Repaint only when the painted result changes. Digits move once a second
    // and the bar a pixel at a time, so redrawing every frame would cost a
    // texture upload sixty times a second to produce the same image.
    const key = redrawKey(shown, BAR_PIXELS)
    if (key === lastKey.current) return
    lastKey.current = key

    paintCounter(context, shown)
    texture.needsUpdate = true
  })

  const bezelW = DISPLAY.WIDTH + DISPLAY.BEZEL_MARGIN * 2
  const bezelD = DISPLAY.DEPTH + DISPLAY.BEZEL_MARGIN * 2

  return (
    // Absorbs clicks for the same reason the cabinet does: it is set into the
    // deck, so a click on it is a click on the machine and must not be taken
    // for one on the empty field around it.
    <group
      position={[DISPLAY.CENTER_X, 0, DISPLAY.CENTER_Z]}
      onClick={(event) => event.stopPropagation()}
    >
      {/* Bezel, so the panel reads as set into the deck rather than stuck on. */}
      <mesh position={[0, 0.0008, 0]} receiveShadow>
        <boxGeometry args={[bezelW, 0.0018, bezelD]} />
        <meshStandardMaterial color="#141110" roughness={0.5} metalness={0.15} />
      </mesh>

      {/* The lit face. */}
      <mesh position={[0, DISPLAY.FACE_Y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[DISPLAY.WIDTH, DISPLAY.DEPTH]} />
        <primitive object={material} attach="material" />
      </mesh>
    </group>
  )
}
