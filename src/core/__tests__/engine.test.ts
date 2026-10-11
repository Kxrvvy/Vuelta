import { describe, expect, it } from 'vitest'

import type { PlaybackSnapshot, PlayerPoll, TrackSummary } from '../contract.js'
import { createEngine, VOLUME_THROTTLE_MS } from '../engine.js'
import { OVERRIDE_TTL_MS } from '../overrides.js'
import type { PlaybackPort } from '../ports.js'

/** A port that records every call instead of making one. */
function fakePort() {
  const calls: string[] = []
  const ok = async () => {
    return { ok: true } as const
  }
  const port: PlaybackPort = {
    getPlayer: async (): Promise<PlayerPoll> => ({ kind: 'no-device' }),
    play: () => {
      calls.push('play')
      return ok()
    },
    pause: () => {
      calls.push('pause')
      return ok()
    },
    seek: (ms) => {
      calls.push(`seek:${ms}`)
      return ok()
    },
    next: () => {
      calls.push('next')
      return ok()
    },
    previous: () => {
      calls.push('previous')
      return ok()
    },
    setVolume: (percent) => {
      calls.push(`volume:${percent}`)
      return ok()
    },
  }
  return { port, calls }
}

function track(id: string, durationMs = 210_000): TrackSummary {
  return {
    trackId: id,
    title: `Track ${id}`,
    artist: 'Someone',
    album: 'An album',
    albumArtUrl: null,
    durationMs,
  }
}

function snapshot(over: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
  return {
    track: track('a'),
    isPlaying: true,
    progressMs: 0,
    volumePercent: 50,
    deviceName: 'Desktop',
    fetchedAt: 0,
    ...over,
  }
}

const poll = (s: PlaybackSnapshot): PlayerPoll => ({ kind: 'ok', snapshot: s })

describe('commands reach the port', () => {
  it('sends play, pause, next and previous', () => {
    const { port, calls } = fakePort()
    const engine = createEngine({ port, now: () => 0 })
    engine.actions.play()
    engine.actions.pause()
    engine.actions.next()
    engine.actions.previous()
    expect(calls).toEqual(['play', 'pause', 'next', 'previous'])
  })

  it('rounds and clamps a seek', () => {
    const { port, calls } = fakePort()
    const engine = createEngine({ port, now: () => 0 })
    engine.actions.seek(-50)
    engine.actions.seek(1234.7)
    expect(calls).toEqual(['seek:0', 'seek:1235'])
  })
})

describe('optimistic overrides', () => {
  it('shows play immediately, before any poll confirms it', () => {
    const { port } = fakePort()
    const engine = createEngine({ port, now: () => 0 })
    engine.applyPoll(poll(snapshot({ isPlaying: false })), 0)
    engine.actions.play()
    expect(engine.read(0).isPlaying).toBe(true)
  })

  it('discards an in-flight poll that contradicts a fresh action', () => {
    // Spec §8's weekend-costing bug, asserted directly.
    const { port } = fakePort()
    const engine = createEngine({ port, now: () => 0 })
    engine.actions.pause()
    engine.applyPoll(poll(snapshot({ isPlaying: true })), 100)
    expect(engine.read(100).isPlaying).toBe(false)
  })

  it('yields to the server once the claim expires', () => {
    const { port } = fakePort()
    const engine = createEngine({ port, now: () => 0 })
    engine.actions.pause()
    const later = OVERRIDE_TTL_MS + 1
    engine.applyPoll(poll(snapshot({ isPlaying: true })), later)
    expect(engine.read(later).isPlaying).toBe(true)
  })

  it('does not snap backwards when a skip has not landed yet', () => {
    const { port } = fakePort()
    const engine = createEngine({ port, now: () => 0 })
    engine.applyPoll(poll(snapshot({ track: track('a'), progressMs: 100_000 })), 0)

    engine.actions.next()
    expect(engine.read(10).progressMs).toBe(0)

    // A poll already in flight reports the OLD track, deep into it.
    engine.applyPoll(poll(snapshot({ track: track('a'), progressMs: 101_000 })), 20)
    expect(engine.read(20).progressMs).toBe(0)

    // The next poll has the new track; now it is adopted.
    engine.applyPoll(poll(snapshot({ track: track('b'), progressMs: 500 })), 30)
    expect(engine.read(30).track?.trackId).toBe('b')
    expect(engine.read(30).progressMs).toBe(500)
  })
})

describe('track changes', () => {
  it('jumps rather than eases across a track boundary', () => {
    const { port } = fakePort()
    const engine = createEngine({ port, now: () => 0 })
    engine.applyPoll(poll(snapshot({ track: track('a'), progressMs: 200_000 })), 0)
    engine.applyPoll(poll(snapshot({ track: track('b'), progressMs: 0 })), 1000)
    expect(engine.read(1000).progressMs).toBe(0)
  })

  it('adopts the new duration', () => {
    const { port } = fakePort()
    const engine = createEngine({ port, now: () => 0 })
    engine.applyPoll(poll(snapshot({ track: track('a', 100_000) })), 0)
    engine.applyPoll(poll(snapshot({ track: track('b', 300_000) })), 1000)
    expect(engine.read(1000).durationMs).toBe(300_000)
  })
})

describe('volume throttling', () => {
  it('responds instantly but sends at most one call per throttle window', () => {
    const { port, calls } = fakePort()
    let clock = 0
    const engine = createEngine({ port, now: () => clock })

    engine.actions.setVolume(10)
    expect(engine.read(clock).volumePercent).toBe(10) // instant feedback

    engine.actions.setVolume(20)
    engine.actions.setVolume(30)
    engine.tick(16, clock)
    expect(calls).toEqual(['volume:30'])

    // Within the window, nothing more goes out.
    engine.actions.setVolume(40)
    clock += VOLUME_THROTTLE_MS - 50
    engine.tick(16, clock)
    expect(calls).toEqual(['volume:30'])

    // Past it, the latest value is sent — never dropped.
    clock += 100
    engine.tick(16, clock)
    expect(calls).toEqual(['volume:30', 'volume:40'])
  })

  it('clamps to 0–100', () => {
    const { port, calls } = fakePort()
    const engine = createEngine({ port, now: () => 0 })
    engine.actions.setVolume(500)
    engine.tick(16, 0)
    expect(calls).toEqual(['volume:100'])
  })
})

describe('arm drag', () => {
  it('commits exactly one seek, on release', () => {
    const { port, calls } = fakePort()
    const engine = createEngine({ port, now: () => 0 })
    engine.applyPoll(poll(snapshot()), 0)

    engine.beginArmDrag()
    engine.dragToProgress(30_000)
    engine.dragToProgress(60_000)
    engine.dragToProgress(90_000)
    expect(calls).toEqual([]) // spec §10: never during the drag

    engine.endArmDrag(0)
    expect(calls).toEqual(['seek:90000'])
  })

  it('holds position against polls arriving mid-drag', () => {
    const { port } = fakePort()
    const engine = createEngine({ port, now: () => 0 })
    engine.applyPoll(poll(snapshot()), 0)
    engine.beginArmDrag()
    engine.dragToProgress(90_000)
    engine.applyPoll(poll(snapshot({ progressMs: 2000 })), 10)
    expect(engine.read(10).progressMs).toBe(90_000)
  })
})

describe('poll outcomes', () => {
  it('does not count a missing device as a failure', () => {
    const { port } = fakePort()
    const engine = createEngine({ port, now: () => 0 })
    expect(engine.applyPoll({ kind: 'no-device' }, 0).failure).toBe(false)
  })

  it('passes Retry-After through for the backoff to use', () => {
    const { port } = fakePort()
    const engine = createEngine({ port, now: () => 0 })
    const outcome = engine.applyPoll(
      { kind: 'error', code: 'rate-limited', message: 'slow down', retryAfterMs: 7000 },
      0,
    )
    expect(outcome).toEqual({ failure: true, retryAfterMs: 7000 })
  })

  it('surfaces a command failure once, then forgets it', async () => {
    const calls: string[] = []
    const port: PlaybackPort = {
      ...fakePort().port,
      play: async () => {
        calls.push('play')
        return { ok: false, code: 'no-device', message: 'Spotify is not running.' } as const
      },
    }
    const engine = createEngine({ port, now: () => 0 })
    engine.actions.play()
    await Promise.resolve()
    await Promise.resolve()
    expect(engine.takeFailure()).toEqual({
      code: 'no-device',
      message: 'Spotify is not running.',
    })
    expect(engine.takeFailure()).toBeNull()
  })
})
