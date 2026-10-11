import { describe, expect, it } from 'vitest'

import { optimistic, OVERRIDE_TTL_MS, withinMs } from '../overrides.js'

describe('optimistic claims', () => {
  it('holds a claimed value', () => {
    const o = optimistic<boolean>()
    o.claim(true, 1000)
    expect(o.peek(1000)).toBe(true)
    expect(o.peek(1000 + OVERRIDE_TTL_MS - 1)).toBe(true)
  })

  it('reports nothing before anything is claimed', () => {
    expect(optimistic<number>().peek(0)).toBeUndefined()
  })

  it('expires after the TTL, so a silently failed command cannot freeze the UI', () => {
    const o = optimistic<boolean>()
    o.claim(true, 1000)
    expect(o.peek(1000 + OVERRIDE_TTL_MS)).toBeUndefined()
    expect(o.isActive(1000 + OVERRIDE_TTL_MS)).toBe(false)
  })

  it('discards contradicting server data while the claim is alive', () => {
    // The exact bug spec §8 describes: press next, a poll already in flight
    // arrives with the old value, and the UI must not snap backwards.
    const o = optimistic<boolean>()
    o.claim(true, 0)
    expect(o.settle(false, 100)).toBe(true)
  })

  it('retires the claim once the server agrees', () => {
    const o = optimistic<boolean>()
    o.claim(true, 0)
    expect(o.settle(true, 100)).toBe(true)
    expect(o.isActive(101)).toBe(false)
  })

  it('yields to the server once expired', () => {
    const o = optimistic<boolean>()
    o.claim(true, 0)
    expect(o.settle(false, OVERRIDE_TTL_MS + 1)).toBe(false)
  })

  it('can be cleared outright', () => {
    const o = optimistic<number>()
    o.claim(42, 0)
    o.clear()
    expect(o.peek(0)).toBeUndefined()
  })

  it('honours a custom TTL', () => {
    const o = optimistic<number>()
    o.claim(1, 0, 100)
    expect(o.peek(99)).toBe(1)
    expect(o.peek(100)).toBeUndefined()
  })
})

describe('withinMs', () => {
  it('treats near-enough positions as agreement', () => {
    // A seek will never come back as the exact millisecond requested, and
    // playback has moved on by the time the next poll lands.
    const o = optimistic<number>(withinMs(2500))
    o.claim(60_000, 0)
    expect(o.settle(61_200, 100)).toBe(60_000)
    expect(o.isActive(101)).toBe(false)
  })

  it('keeps protecting when the server is still far away', () => {
    const o = optimistic<number>(withinMs(2500))
    o.claim(60_000, 0)
    expect(o.settle(10_000, 100)).toBe(60_000)
    expect(o.isActive(101)).toBe(true)
  })
})
