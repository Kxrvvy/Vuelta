import { describe, expect, it } from 'vitest'

import {
  createClock,
  RECONCILE_DEADBAND_MS,
  RECONCILE_SNAP_MS,
} from '../clock.js'

/**
 * Run the clock for exactly `ms` of wall time at a given frame rate.
 * The final partial frame matters: ticking a whole frame past the target
 * would overshoot and make these assertions lie about the drift.
 */
function run(clock: ReturnType<typeof createClock>, ms: number, frameMs = 16) {
  let remaining = ms
  while (remaining > 0) {
    const step = Math.min(frameMs, remaining)
    clock.tick(step)
    remaining -= step
  }
}

describe('advancing', () => {
  it('does not move while paused', () => {
    const clock = createClock({ durationMs: 200_000 })
    run(clock, 1000)
    expect(clock.read().progressMs).toBe(0)
  })

  it('advances in real time while playing', () => {
    const clock = createClock({ durationMs: 200_000, isPlaying: true })
    run(clock, 1000)
    expect(clock.read().progressMs).toBeCloseTo(1000, -1)
  })

  it('advances at the same rate regardless of frame rate', () => {
    const fast = createClock({ durationMs: 200_000, isPlaying: true })
    const slow = createClock({ durationMs: 200_000, isPlaying: true })
    run(fast, 2000, 8)
    run(slow, 2000, 50)
    expect(fast.read().progressMs).toBeCloseTo(slow.read().progressMs, 0)
  })

  it('never runs past the end of the track', () => {
    const clock = createClock({ durationMs: 1000, isPlaying: true })
    run(clock, 5000)
    expect(clock.read().progressMs).toBe(1000)
  })

  it('ignores nonsense deltas', () => {
    const clock = createClock({ durationMs: 200_000, isPlaying: true })
    clock.tick(Number.NaN)
    clock.tick(-500)
    clock.tick(0)
    expect(clock.read().progressMs).toBe(0)
  })
})

describe('reconciling with the server', () => {
  it('ignores drift below the deadband, because correcting noise is jitter', () => {
    const clock = createClock({ durationMs: 200_000, isPlaying: true })
    clock.hardSet(10_000)
    clock.reconcile({ progressMs: 10_000 + RECONCILE_DEADBAND_MS - 1, isPlaying: true })
    run(clock, 2000)
    // Only the 2s of normal playback, no correction folded in.
    expect(clock.read().progressMs).toBeCloseTo(12_000, -2)
  })

  it('eases across mid-sized drift rather than snapping', () => {
    const clock = createClock({ durationMs: 200_000, isPlaying: false })
    clock.hardSet(10_000)
    clock.reconcile({ progressMs: 11_000, isPlaying: false })

    // Immediately after reconciling, nothing has moved yet.
    expect(clock.read().progressMs).toBe(10_000)

    // One frame in, it has started moving but is nowhere near arrived.
    clock.tick(16)
    const afterOneFrame = clock.read().progressMs
    expect(afterOneFrame).toBeGreaterThan(10_000)
    expect(afterOneFrame).toBeLessThan(10_100)

    // Given time, it arrives.
    run(clock, 3000)
    expect(clock.read().progressMs).toBeCloseTo(11_000, -2)
  })

  it('snaps when drift is too large to ease across', () => {
    const clock = createClock({ durationMs: 200_000, isPlaying: false })
    clock.hardSet(10_000)
    clock.reconcile({ progressMs: 10_000 + RECONCILE_SNAP_MS + 1, isPlaying: false })
    // Snapped immediately, with no ticks at all.
    expect(clock.read().progressMs).toBe(10_000 + RECONCILE_SNAP_MS + 1)
  })

  it('takes isPlaying from the server even when position is left alone', () => {
    const clock = createClock({ durationMs: 200_000, isPlaying: true })
    clock.reconcile({ progressMs: 0, isPlaying: false })
    expect(clock.read().isPlaying).toBe(false)
  })
})

describe('dragging', () => {
  it('suspends the clock while dragging', () => {
    const clock = createClock({ durationMs: 200_000, isPlaying: true })
    clock.hardSet(5000)
    clock.beginDrag()
    run(clock, 2000)
    expect(clock.read().progressMs).toBe(5000)
  })

  it('ignores the server while the user is dragging', () => {
    const clock = createClock({ durationMs: 200_000, isPlaying: true })
    clock.beginDrag()
    clock.dragTo(120_000)
    clock.reconcile({ progressMs: 5000, isPlaying: true })
    expect(clock.read().progressMs).toBe(120_000)
  })

  it('returns the committed position on release and resumes', () => {
    const clock = createClock({ durationMs: 200_000, isPlaying: true })
    clock.beginDrag()
    clock.dragTo(90_000)
    expect(clock.endDrag()).toBe(90_000)
    expect(clock.read().isDragging).toBe(false)
    run(clock, 1000)
    expect(clock.read().progressMs).toBeCloseTo(91_000, -1)
  })

  it('clamps a drag to the track', () => {
    const clock = createClock({ durationMs: 10_000 })
    clock.beginDrag()
    clock.dragTo(999_999)
    expect(clock.read().progressMs).toBe(10_000)
    clock.dragTo(-500)
    expect(clock.read().progressMs).toBe(0)
  })

  it('does nothing on dragTo when no drag is in progress', () => {
    const clock = createClock({ durationMs: 200_000 })
    clock.hardSet(1234)
    clock.dragTo(99_000)
    expect(clock.read().progressMs).toBe(1234)
  })
})
