import { describe, expect, it } from 'vitest'

import {
  CLICK_SLOP_PX,
  isSwipeDrag,
  SWIPE_RUBBER_PX,
  SWIPE_THRESHOLD_PX,
  swipeOffset,
  swipeOutcome,
} from '../discSwipe.js'

describe('telling a swipe from a click', () => {
  it('leaves a press that barely moves as a click', () => {
    expect(isSwipeDrag(0, 0)).toBe(false)
    expect(isSwipeDrag(3, 2)).toBe(false)
    expect(isSwipeDrag(CLICK_SLOP_PX, 0)).toBe(false)
  })

  it('counts anything past the slop as a drag, in any direction', () => {
    expect(isSwipeDrag(CLICK_SLOP_PX + 1, 0)).toBe(true)
    expect(isSwipeDrag(-CLICK_SLOP_PX - 1, 0)).toBe(true)
    expect(isSwipeDrag(0, CLICK_SLOP_PX + 1)).toBe(true)
  })

  it('survives a pointer event with nothing useful in it', () => {
    expect(isSwipeDrag(Number.NaN, 0)).toBe(false)
    expect(swipeOffset(Number.NaN)).toBe(0)
    expect(swipeOutcome(Number.NaN, 0)).toBe('none')
  })
})

describe('how far the record follows', () => {
  it('goes nowhere when the pointer does', () => {
    expect(swipeOffset(0)).toBe(0)
  })

  it('follows the direction of travel', () => {
    expect(swipeOffset(50)).toBeGreaterThan(0)
    expect(swipeOffset(-50)).toBeLessThan(0)
    expect(swipeOffset(-50)).toBeCloseTo(-swipeOffset(50), 10)
  })

  it('sets off at the pointer’s own speed, so it does not feel stuck', () => {
    // The first pixel is very nearly one-for-one: the derivative at zero is 1.
    expect(swipeOffset(1)).toBeGreaterThan(0.99)
    expect(swipeOffset(1)).toBeLessThan(1)
  })

  it('falls behind further out, and never reaches the ceiling', () => {
    const near = swipeOffset(40)
    const far = swipeOffset(400)
    expect(near).toBeLessThan(40)
    expect(far).toBeLessThan(SWIPE_RUBBER_PX)
    // Still moving outward, just by less and less.
    expect(swipeOffset(500)).toBeGreaterThan(far)
    // Asymptotic in maths, saturating in doubles: past about 1800px the
    // exponential underflows and the offset *is* the ceiling. Which is the
    // behaviour wanted anyway -- it must never go beyond it.
    expect(swipeOffset(100_000)).toBeLessThanOrEqual(SWIPE_RUBBER_PX)
    expect(swipeOffset(1000)).toBeLessThan(SWIPE_RUBBER_PX)
  })

  it('never turns back on itself', () => {
    let previous = 0
    for (let dx = 1; dx <= 600; dx += 7) {
      const at = swipeOffset(dx)
      expect(at).toBeGreaterThan(previous)
      previous = at
    }
  })
})

describe('what a release means', () => {
  it('does nothing short of the threshold', () => {
    expect(swipeOutcome(0, 0)).toBe('none')
    expect(swipeOutcome(SWIPE_THRESHOLD_PX - 1, 0)).toBe('none')
    expect(swipeOutcome(-SWIPE_THRESHOLD_PX + 1, 0)).toBe('none')
  })

  it('takes the next track to the left and the previous to the right', () => {
    expect(swipeOutcome(-SWIPE_THRESHOLD_PX, 0)).toBe('next')
    expect(swipeOutcome(-300, 0)).toBe('next')
    expect(swipeOutcome(SWIPE_THRESHOLD_PX, 0)).toBe('previous')
    expect(swipeOutcome(300, 0)).toBe('previous')
  })

  it('ignores a travel that is mostly up or down', () => {
    // Long enough horizontally, but further vertically: on its way elsewhere.
    expect(swipeOutcome(-200, 260)).toBe('none')
    expect(swipeOutcome(200, -260)).toBe('none')
    // Equal counts as vertical, so a diagonal never skips by accident.
    expect(swipeOutcome(-200, 200)).toBe('none')
    expect(swipeOutcome(-200, 120)).toBe('next')
  })

  it('keeps the threshold well clear of the click slop', () => {
    // The gap between "this was a click" and "this takes the song away" is the
    // whole safety margin of the gesture.
    expect(SWIPE_THRESHOLD_PX).toBeGreaterThan(CLICK_SLOP_PX * 10)
  })
})
