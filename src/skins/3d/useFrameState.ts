/**
 * The seam between React and the animation loop.
 *
 * CLAUDE.md: "Never animate through React state. `armAngle` and `progressMs`
 * must not live in `useState`. Core owns them and notifies subscribers
 * imperatively; skins write `transform` directly via refs."
 *
 * So the scene is handed a *ref* to the current RenderState, not a prop that
 * changes sixty times a second. React builds the scene graph once; every frame
 * after that, `useFrame` reads the ref and mutates Object3D transforms
 * directly. Nothing in this skin ever calls a setState from a frame callback.
 *
 * The only values passed as real props are the ones that genuinely should
 * cause React to do work — `albumArtUrl`, which loads a texture, and `view`,
 * which moves the camera.
 */

import { createContext, useContext } from 'react'
import type { RefObject } from 'react'
import type { RenderState } from '../../core/contract.js'

export type RenderStateRef = RefObject<RenderState>

const RenderStateContext = createContext<RenderStateRef | null>(null)

export const RenderStateProvider = RenderStateContext.Provider

/**
 * Read the live RenderState ref. Safe to call in `useFrame`; the object it
 * returns is mutated in place by whoever owns the state, so never destructure
 * it outside the frame callback or you will capture a stale snapshot.
 */
export function useRenderStateRef(): RenderStateRef {
  const ref = useContext(RenderStateContext)
  if (!ref) {
    throw new Error('Turntable scene rendered outside a RenderStateProvider.')
  }
  return ref
}

/** Frame-rate independent exponential approach. Use instead of a fixed step. */
export function damp(current: number, target: number, lambda: number, delta: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * delta))
}

export const DEG = Math.PI / 180
