/**
 * What the scene is allowed to do to the world.
 *
 * Still only `Actions` plus the gestures that have no Action of their own
 * (the lid, and the three phases of an arm drag). The skin has no idea what
 * any of it talks to.
 */

import { createContext, useContext } from 'react'
import type { RefObject } from 'react'
import type { Actions } from '../../../core/contract.js'

export type SkinInteraction = {
  actions: Actions
  /** The Open button. A latch release: no-op when the lid is already open. */
  openLid(): void
  /** Clicking the acrylic. No-op when it is already shut. */
  closeLid(): void
  beginArmDrag(): void
  dragToProgress(progressMs: number): void
  endArmDrag(): void
  /**
   * The floating timestamp element, which lives outside the canvas so it can
   * be real text. A component inside the canvas projects the stylus position
   * each frame and writes to it directly — never through React state.
   */
  readoutRef: RefObject<HTMLDivElement | null>
}

const InteractionContext = createContext<SkinInteraction | null>(null)

export const InteractionProvider = InteractionContext.Provider

export function useInteraction(): SkinInteraction {
  const value = useContext(InteractionContext)
  if (!value) throw new Error('Turntable scene rendered outside an InteractionProvider.')
  return value
}
