/**
 * The single store, built on Zustand's **vanilla** API rather than the React
 * binding. That choice is what keeps `core/` importable from a plain Vitest
 * file with no DOM: nothing here touches React, and the React layer subscribes
 * from the outside.
 *
 * M0 scope: this holds setup info, the app phase, and the latest snapshot.
 * `progressMs` is copied straight from the poll.
 *
 * M1 will change that. Ownership of `progressMs` moves to a dedicated clock
 * module — spec §8, "one module owns time" — and this store stops writing it
 * directly. The seam is marked below.
 */

import { createStore } from 'zustand/vanilla'
import type { AppEvent, AppState } from './appState.js'
import { INITIAL_APP_STATE, reduce } from './appState.js'
import type { PlaybackSnapshot, PlayerPoll, RenderState, SetupInfo } from './contract.js'
import { INITIAL_RENDER_STATE } from './contract.js'

export type VueltaState = {
  app: AppState
  setup: SetupInfo | null
  snapshot: PlaybackSnapshot | null
  /** What a skin is allowed to see. M0 renders it as text. */
  render: RenderState

  dispatch: (event: AppEvent) => void
  setSetup: (setup: SetupInfo) => void
  applyPoll: (poll: PlayerPoll) => void
}

/**
 * Project a snapshot onto the render contract.
 *
 * Kept as a standalone pure function so it can be tested without a store, and
 * so M1 can wrap it with the extrapolating clock instead of rewriting it.
 */
export function projectSnapshot(previous: RenderState, snapshot: PlaybackSnapshot): RenderState {
  return {
    ...previous,
    progressMs: snapshot.progressMs,
    durationMs: snapshot.track?.durationMs ?? 0,
    isPlaying: snapshot.isPlaying,
    albumArtUrl: snapshot.track?.albumArtUrl ?? null,
  }
}

export function createVueltaStore() {
  return createStore<VueltaState>()((set, get) => ({
    app: INITIAL_APP_STATE,
    setup: null,
    snapshot: null,
    render: INITIAL_RENDER_STATE,

    dispatch: (event) => set({ app: reduce(get().app, event) }),

    setSetup: (setup) => set({ setup }),

    applyPoll: (poll) => {
      const state = get()
      switch (poll.kind) {
        case 'ok':
          set({
            app: reduce(state.app, { type: 'POLL_OK', isPlaying: poll.snapshot.isPlaying }),
            snapshot: poll.snapshot,
            render: projectSnapshot(state.render, poll.snapshot),
          })
          return
        case 'no-device':
          // 204 with an empty body. Not an error.
          set({
            app: reduce(state.app, { type: 'POLL_NO_DEVICE' }),
            snapshot: null,
          })
          return
        case 'error':
          set({
            app: reduce(state.app, {
              type: 'POLL_FAILED',
              code: poll.code,
              message: poll.message,
            }),
          })
          return
      }
    },
  }))
}

export type VueltaStore = ReturnType<typeof createVueltaStore>
