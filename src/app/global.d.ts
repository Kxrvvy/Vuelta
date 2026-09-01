import type { VueltaBridge } from '../core/contract.js'

declare global {
  interface Window {
    /** Exposed by the preload script. The renderer's only route to the outside. */
    vuelta: VueltaBridge
  }
}

export {}
