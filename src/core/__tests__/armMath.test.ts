import { describe, expect, it } from 'vitest'

import { armAngleFor, armAngleNow, isAtRest, trackProgressRatio } from '../armMath.js'
import { ARM } from '../contract.js'

const THREE_THIRTY = 210_000 // 3:30, the track length spec §10 reasons about

describe('armAngleFor', () => {
  it('starts at the outer groove', () => {
    expect(armAngleFor(0, THREE_THIRTY)).toBe(ARM.START_ANGLE)
  })

  it('reaches the inner groove at the end of the track', () => {
    expect(armAngleFor(THREE_THIRTY, THREE_THIRTY)).toBe(ARM.END_ANGLE)
  })

  it('sits halfway across the sweep at the midpoint', () => {
    const middle = ARM.START_ANGLE + (ARM.END_ANGLE - ARM.START_ANGLE) / 2
    expect(armAngleFor(THREE_THIRTY / 2, THREE_THIRTY)).toBeCloseTo(middle, 10)
  })

  it('clamps past the end rather than sending the arm through the spindle', () => {
    // Routine, not defensive: the local clock runs ahead of the poll between
    // reconciliations, so progress > duration happens on every track.
    expect(armAngleFor(THREE_THIRTY * 2, THREE_THIRTY)).toBe(ARM.END_ANGLE)
  })

  it('clamps negative progress', () => {
    expect(armAngleFor(-5000, THREE_THIRTY)).toBe(ARM.START_ANGLE)
  })

  it('does not divide by zero when the track has no duration', () => {
    // Spotify reports no duration for some local files and podcast episodes.
    const angle = armAngleFor(1000, 0)
    expect(Number.isFinite(angle)).toBe(true)
    expect(angle).toBe(ARM.START_ANGLE)
  })

  it('survives non-finite input', () => {
    expect(armAngleFor(Number.NaN, THREE_THIRTY)).toBe(ARM.START_ANGLE)
    expect(armAngleFor(1000, Number.NaN)).toBe(ARM.START_ANGLE)
    expect(armAngleFor(1000, Number.POSITIVE_INFINITY)).toBe(ARM.START_ANGLE)
  })

  it('advances monotonically across the whole track', () => {
    let previous = Number.NEGATIVE_INFINITY
    for (let ms = 0; ms <= THREE_THIRTY; ms += 5_000) {
      const angle = armAngleFor(ms, THREE_THIRTY)
      expect(angle).toBeGreaterThanOrEqual(previous)
      previous = angle
    }
  })

  it('stays inside the groove band for every position', () => {
    for (let ms = 0; ms <= THREE_THIRTY; ms += 1_000) {
      const angle = armAngleFor(ms, THREE_THIRTY)
      expect(angle).toBeGreaterThanOrEqual(ARM.START_ANGLE)
      expect(angle).toBeLessThanOrEqual(ARM.END_ANGLE)
    }
  })

  it('moves about 9.5 seconds per degree on a 3:30 track', () => {
    // Spec §10's precision problem, asserted so it cannot drift silently:
    // 22° across 3:30 is why dragging needs Shift-to-slow and a readout.
    const secondsPerDegree = THREE_THIRTY / 1000 / (ARM.END_ANGLE - ARM.START_ANGLE)
    expect(secondsPerDegree).toBeCloseTo(9.5, 1)
  })
})

describe('trackProgressRatio', () => {
  it('spans 0 to 1', () => {
    expect(trackProgressRatio(0, THREE_THIRTY)).toBe(0)
    expect(trackProgressRatio(THREE_THIRTY, THREE_THIRTY)).toBe(1)
  })

  it('clamps and tolerates a zero duration', () => {
    expect(trackProgressRatio(THREE_THIRTY * 3, THREE_THIRTY)).toBe(1)
    expect(trackProgressRatio(-1, THREE_THIRTY)).toBe(0)
    expect(trackProgressRatio(1000, 0)).toBe(0)
  })
})

describe('armAngleNow', () => {
  const PLAYING = {
    lidOpen: true,
    isPlaying: true,
    isDragging: false,
    progressMs: THREE_THIRTY / 2,
    durationMs: THREE_THIRTY,
  }

  it('tracks the groove while the record plays', () => {
    expect(armAngleNow(PLAYING)).toBeCloseTo(armAngleFor(THREE_THIRTY / 2, THREE_THIRTY), 10)
  })

  it('returns the arm to its rest position when paused', () => {
    expect(armAngleNow({ ...PLAYING, isPlaying: false })).toBe(ARM.REST_ANGLE)
  })

  it('parks it with the lid shut, playing or not', () => {
    expect(armAngleNow({ ...PLAYING, lidOpen: false })).toBe(ARM.REST_ANGLE)
    expect(armAngleNow({ ...PLAYING, lidOpen: false, isPlaying: false })).toBe(ARM.REST_ANGLE)
  })

  it('parks it when nothing is playing at all', () => {
    expect(armAngleNow({ ...PLAYING, isPlaying: false, progressMs: 0, durationMs: 0 })).toBe(
      ARM.REST_ANGLE,
    )
  })

  it('lets a drag outrank the park, so scrubbing works while paused', () => {
    // The hand is on the arm. It goes where the pointer put it, and the seek
    // still commits on release; it returns to rest afterwards because it is
    // still paused.
    const dragged = armAngleNow({ ...PLAYING, isPlaying: false, isDragging: true })
    expect(dragged).toBeCloseTo(armAngleFor(THREE_THIRTY / 2, THREE_THIRTY), 10)
    expect(dragged).not.toBe(ARM.REST_ANGLE)
  })

  it('does not let a drag override a shut lid being dragged shut', () => {
    // A drag with the lid closed is not reachable -- the arm is not drawn --
    // but the ordering is stated here so it cannot change by accident.
    expect(armAngleNow({ ...PLAYING, lidOpen: false, isDragging: true })).toBeCloseTo(
      armAngleFor(THREE_THIRTY / 2, THREE_THIRTY),
      10,
    )
  })

  it('is the rest angle, not merely below the groove band', () => {
    // The skins read REST_ANGLE as a sentinel: the 3D arm goes to its cradle
    // and the flat-lay draws its vertical park. An angle that merely sat below
    // START would be clamped onto the groove instead.
    expect(isAtRest(armAngleNow({ ...PLAYING, isPlaying: false }))).toBe(true)
  })
})

describe('isAtRest', () => {
  it('is true at and below the cradle angle', () => {
    expect(isAtRest(ARM.REST_ANGLE)).toBe(true)
    expect(isAtRest(ARM.REST_ANGLE - 1)).toBe(true)
  })

  it('is false anywhere on the record', () => {
    expect(isAtRest(ARM.START_ANGLE)).toBe(false)
    expect(isAtRest(ARM.END_ANGLE)).toBe(false)
  })
})
