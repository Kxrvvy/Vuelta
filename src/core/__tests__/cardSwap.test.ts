import { describe, expect, it } from 'vitest'

import { cardSwap, CARD_SWAP_MS } from '../cardSwap.js'

describe('the card move', () => {
  it('starts and ends home on the stack', () => {
    expect(cardSwap(0).out).toBe(0)
    expect(cardSwap(1).out).toBe(0)
  })

  it('ends at the other depth, having started at this one', () => {
    expect(cardSwap(0).crossed).toBe(0)
    expect(cardSwap(1).crossed).toBe(1)
  })

  it('is fully clear of the stack for the whole of the depth change', () => {
    // The point of three phases rather than two: the card must never change
    // depth while it still overlaps the record, or it passes through it.
    for (let p = 0.36; p <= 0.64; p += 0.01) {
      const at = cardSwap(p)
      if (at.crossed > 0 && at.crossed < 1) expect(at.out).toBe(1)
    }
  })

  it('does not begin crossing until it is out, nor finish before it is back', () => {
    expect(cardSwap(0.2).crossed).toBe(0)
    expect(cardSwap(0.34).crossed).toBe(0)
    expect(cardSwap(0.8).crossed).toBe(1)
  })

  it('moves monotonically out and then monotonically back', () => {
    let previous = -1
    for (let p = 0; p <= 0.35; p += 0.01) {
      const { out } = cardSwap(p)
      expect(out).toBeGreaterThanOrEqual(previous)
      previous = out
    }
    previous = 2
    for (let p = 0.65; p <= 1; p += 0.01) {
      const { out } = cardSwap(p)
      expect(out).toBeLessThanOrEqual(previous)
      previous = out
    }
  })

  it('is continuous across both joins', () => {
    // A step at a phase boundary is a visible jolt, and the arithmetic that
    // produces one looks perfectly reasonable in isolation.
    for (const join of [0.35, 0.65]) {
      const before = cardSwap(join - 0.001)
      const after = cardSwap(join + 0.001)
      expect(Math.abs(after.out - before.out)).toBeLessThan(0.02)
      expect(Math.abs(after.crossed - before.crossed)).toBeLessThan(0.02)
    }
  })

  it('clamps outside the move rather than running past it', () => {
    expect(cardSwap(-5)).toEqual(cardSwap(0))
    expect(cardSwap(5)).toEqual(cardSwap(1))
    expect(cardSwap(Number.NaN)).toEqual(cardSwap(0))
  })

  it('takes long enough to read as a movement', () => {
    expect(CARD_SWAP_MS).toBeGreaterThanOrEqual(400)
    expect(CARD_SWAP_MS).toBeLessThanOrEqual(900)
  })
})
