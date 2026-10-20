import { describe, expect, it } from 'vitest'

import {
  CROSSFADE_MS,
  EXTEND_MS,
  IDLE_TRANSITION,
  RETRACT_MS,
  SWAP_LEAD_MS,
  SWAP_TOTAL_MS,
  stepTransition,
  type Transition,
  type TransitionInput,
} from '../transition.js'

const PLAYING: Omit<TransitionInput, 'deltaMs' | 'remainingMs'> = {
  durationMs: 210_000,
  trackChanged: false,
  hasNext: true,
  isPlaying: true,
}

/** Run frames at 16ms until `stop` says to halt, or the budget runs out. */
function run(
  from: Transition,
  stop: (state: Transition, elapsedTotal: number) => boolean,
  overrides: Partial<TransitionInput> = {},
): { state: Transition; totalMs: number; seen: Transition[] } {
  let state = from
  let totalMs = 0
  const seen: Transition[] = []

  while (!stop(state, totalMs) && totalMs < 10_000) {
    state = stepTransition(state, {
      ...PLAYING,
      deltaMs: 16,
      remainingMs: 500,
      ...overrides,
    })
    totalMs += 16
    seen.push(state)
  }

  return { state, totalMs, seen }
}

describe('the record swap', () => {
  it('sits idle with the record out while the track plays', () => {
    const next = stepTransition(IDLE_TRANSITION, {
      ...PLAYING,
      deltaMs: 16,
      remainingMs: 120_000,
    })
    expect(next.phase).toBe('idle')
    expect(next.out).toBe(1)
  })

  it('arms on the local clock, not on a poll reporting the change', () => {
    // The whole point of spec §13: at this instant the track has NOT changed
    // and no poll has said anything.
    const next = stepTransition(IDLE_TRANSITION, {
      ...PLAYING,
      deltaMs: 16,
      remainingMs: SWAP_LEAD_MS - 1,
    })
    expect(next.phase).toBe('retracting')
    expect(next.showNext).toBe(false)
  })

  it('does not arm a frame too early', () => {
    const next = stepTransition(IDLE_TRANSITION, {
      ...PLAYING,
      deltaMs: 16,
      remainingMs: SWAP_LEAD_MS + 1,
    })
    expect(next.phase).toBe('idle')
  })

  it('runs retract, swap, extend in order and lands back on idle', () => {
    const phases: string[] = []
    let state = stepTransition(IDLE_TRANSITION, {
      ...PLAYING,
      deltaMs: 16,
      remainingMs: 100,
    })

    let total = 0
    while (state.phase !== 'idle' && total < 10_000) {
      if (phases.at(-1) !== state.phase) phases.push(state.phase)
      state = stepTransition(state, { ...PLAYING, deltaMs: 16, remainingMs: 0 })
      total += 16
    }

    expect(phases).toEqual(['retracting', 'swapping', 'extending'])
    expect(state.out).toBe(1)
  })

  it('fits the 2-3 second budget', () => {
    expect(SWAP_TOTAL_MS).toBe(RETRACT_MS + CROSSFADE_MS + EXTEND_MS)
    expect(SWAP_TOTAL_MS).toBeGreaterThanOrEqual(1000)
    expect(SWAP_TOTAL_MS).toBeLessThanOrEqual(3000)
  })

  it('hides the disc completely for the whole of the crossfade', () => {
    // This is the invariant the three phases exist for. If the disc is even
    // slightly out while the art changes, the swap is visible.
    const start = stepTransition(IDLE_TRANSITION, {
      ...PLAYING,
      deltaMs: 16,
      remainingMs: 100,
    })
    const { seen } = run(start, (s) => s.phase === 'extending' && s.elapsedMs > 0, {
      remainingMs: 0,
    })

    const hidden = seen.filter((s) => s.phase === 'swapping')
    expect(hidden.length).toBeGreaterThan(0)
    for (const state of hidden) expect(state.out).toBe(0)
  })

  it('flips showNext exactly once, and only while hidden', () => {
    const start = stepTransition(IDLE_TRANSITION, {
      ...PLAYING,
      deltaMs: 16,
      remainingMs: 100,
    })
    const { seen } = run(start, (s, t) => s.phase === 'idle' && t > 0, { remainingMs: 0 })

    const flips = seen.filter((state, index) => {
      const before = index === 0 ? start.showNext : (seen[index - 1]?.showNext ?? false)
      return state.showNext !== before
    })

    expect(flips).toHaveLength(1)
    expect(flips.at(0)?.phase).toBe('swapping')
    expect(flips.at(0)?.out).toBe(0)
  })

  it('retracts all the way in and extends all the way out', () => {
    const start = stepTransition(IDLE_TRANSITION, {
      ...PLAYING,
      deltaMs: 16,
      remainingMs: 100,
    })
    const { seen } = run(start, (s, t) => s.phase === 'idle' && t > 0, { remainingMs: 0 })

    const retract = seen.filter((s) => s.phase === 'retracting')
    expect(retract.at(0)?.out).toBeGreaterThan(0.9)
    expect(retract.at(-1)?.out).toBeLessThan(0.1)

    const extend = seen.filter((s) => s.phase === 'extending')
    expect(extend.at(0)?.out).toBeLessThan(0.1)
    expect(seen.at(-1)?.out).toBe(1)
  })

  it('treats a track change from idle as a load: it extends only', () => {
    const next = stepTransition(IDLE_TRANSITION, {
      ...PLAYING,
      deltaMs: 16,
      remainingMs: 120_000,
      trackChanged: true,
    })
    // §9: loading a track slides the record out of the sleeve. There is no
    // retract, because there is no old artwork left to hide -- the app's
    // current track is already the new one.
    expect(next.phase).toBe('extending')
    expect(next.out).toBe(0)
    expect(next.showNext).toBe(false)
  })

  it('does not restart when the real boundary lands mid-swap', () => {
    let state = stepTransition(IDLE_TRANSITION, {
      ...PLAYING,
      deltaMs: 16,
      remainingMs: 100,
    })
    expect(state.phase).toBe('retracting')

    // The change the swap was anticipating finally arrives.
    state = stepTransition(state, {
      ...PLAYING,
      deltaMs: 16,
      remainingMs: 180_000,
      trackChanged: true,
    })
    expect(state.phase).toBe('retracting')
    // ...and showNext drops, because `current` has caught up with `next`.
    expect(state.showNext).toBe(false)
  })

  it('will not fire the same boundary swap twice', () => {
    // A clock that lingers past the end -- which it does, between polls --
    // must not re-arm until a real track change.
    const start = stepTransition(IDLE_TRANSITION, {
      ...PLAYING,
      deltaMs: 16,
      remainingMs: 100,
    })
    const { state } = run(start, (s, t) => s.phase === 'idle' && t > 0, { remainingMs: 100 })

    expect(state.phase).toBe('idle')
    expect(state.armed).toBe(false)

    const again = stepTransition(state, { ...PLAYING, deltaMs: 16, remainingMs: 100 })
    expect(again.phase).toBe('idle')

    const rearmed = stepTransition(state, {
      ...PLAYING,
      deltaMs: 16,
      remainingMs: 100,
      trackChanged: true,
    })
    expect(rearmed.armed).toBe(true)
  })

  it('never anticipates a track too short to play the animation', () => {
    for (const durationMs of [0, SWAP_TOTAL_MS - 1, SWAP_TOTAL_MS]) {
      const next = stepTransition(IDLE_TRANSITION, {
        ...PLAYING,
        deltaMs: 16,
        remainingMs: 100,
        durationMs,
      })
      expect(next.phase).toBe('idle')
    }
  })

  it('never anticipates on a clock that has already run past the end', () => {
    // The local clock overshoots between polls, and the frames just after an
    // absorbed change read zero or less.
    for (const remainingMs of [0, -40, -4000]) {
      expect(
        stepTransition(IDLE_TRANSITION, { ...PLAYING, deltaMs: 16, remainingMs }).phase,
      ).toBe('idle')
    }
  })

  it('plays the swap once, not again when the poll confirms the change', () => {
    // Observed in the running app: the anticipated swap finished, then the
    // real track change landed 1.3s later and the whole slide ran a second
    // time. The change an anticipated swap was *for* is not a new one.
    let state = stepTransition(IDLE_TRANSITION, { ...PLAYING, deltaMs: 16, remainingMs: 100 })
    expect(state.phase).toBe('retracting')
    expect(state.expecting).toBe(true)

    // Run it out, with the track not yet officially changed.
    let guard = 0
    while (state.phase !== 'idle' && guard < 400) {
      state = stepTransition(state, { ...PLAYING, deltaMs: 16, remainingMs: 100 })
      guard += 1
    }
    expect(state.phase).toBe('idle')
    expect(state.expecting).toBe(true)

    // Now the poll catches up.
    const confirmed = stepTransition(state, {
      ...PLAYING,
      deltaMs: 16,
      remainingMs: 180_000,
      trackChanged: true,
    })
    expect(confirmed.phase).toBe('idle')
    expect(confirmed.out).toBe(1)
    expect(confirmed.expecting).toBe(false)

    // And a genuinely new change after that still animates.
    const skipped = stepTransition(confirmed, {
      ...PLAYING,
      deltaMs: 16,
      remainingMs: 120_000,
      trackChanged: true,
    })
    expect(skipped.phase).toBe('extending')
  })

  it('never anticipates while paused, or with nothing queued', () => {
    expect(
      stepTransition(IDLE_TRANSITION, {
        ...PLAYING,
        deltaMs: 16,
        remainingMs: 100,
        isPlaying: false,
      }).phase,
    ).toBe('idle')

    expect(
      stepTransition(IDLE_TRANSITION, {
        ...PLAYING,
        deltaMs: 16,
        remainingMs: 100,
        hasNext: false,
      }).phase,
    ).toBe('idle')
  })

  it('survives a frame with a nonsense delta', () => {
    const start = stepTransition(IDLE_TRANSITION, {
      ...PLAYING,
      deltaMs: 16,
      remainingMs: 100,
    })
    const next = stepTransition(start, { ...PLAYING, deltaMs: Number.NaN, remainingMs: 0 })
    expect(Number.isFinite(next.out)).toBe(true)
    expect(next.phase).toBe('retracting')
  })
})
