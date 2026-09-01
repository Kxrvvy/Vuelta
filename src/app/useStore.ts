import { useSyncExternalStore } from 'react'
import type { VueltaState, VueltaStore } from '../core/store.js'

/**
 * The React ↔ core seam.
 *
 * `useSyncExternalStore` subscribes to the vanilla Zustand store from outside,
 * which is what lets core/ stay React-free. Selectors must return stable
 * references — a selector that builds a fresh object on every call will spin
 * React forever.
 *
 * From M1 this stays for structural state only. `armAngle` and `progressMs`
 * must never come through here: animating through React state re-renders the
 * turntable 60 times a second. Those get read imperatively and written
 * straight to `transform` via a ref.
 */
export function useStoreValue<T>(store: VueltaStore, selector: (state: VueltaState) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  )
}
