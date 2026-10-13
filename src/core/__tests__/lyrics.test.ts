import { describe, expect, it } from 'vitest'

import { activeLyricIndex, LYRIC_LEAD_MS, parseLrc } from '../lyrics.js'

const SAMPLE = [
  '[ar:Queen]',
  '[ti:Bohemian Rhapsody]',
  '[00:00.15] Is this the real life?',
  '[00:07.13] Caught in a landslide',
  '[01:14.5] No escape from reality',
].join('\n')

describe('parsing LRC', () => {
  it('reads timestamps and text', () => {
    const lines = parseLrc(SAMPLE)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toEqual({ atMs: 150, text: 'Is this the real life?' })
    expect(lines[1]).toEqual({ atMs: 7_130, text: 'Caught in a landslide' })
  })

  it('treats one fraction digit as tenths, not milliseconds', () => {
    // The trap: ".5" is half a second. Parsing the digits as written would
    // make it five milliseconds and every such line would fire early.
    expect(parseLrc('[01:14.5] x')[0]?.atMs).toBe(74_500)
    expect(parseLrc('[01:14.05] x')[0]?.atMs).toBe(74_050)
    expect(parseLrc('[01:14.005] x')[0]?.atMs).toBe(74_005)
  })

  it('accepts a stamp with no fraction at all', () => {
    expect(parseLrc('[02:03] x')[0]?.atMs).toBe(123_000)
  })

  it('accepts minutes past an hour', () => {
    expect(parseLrc('[75:00.00] x')[0]?.atMs).toBe(4_500_000)
  })

  it('expands a line written with several stamps', () => {
    // How a chorus is written once and sung three times.
    const lines = parseLrc('[00:10.00][01:20.00][02:30.00] the chorus')
    expect(lines.map((line) => line.atMs)).toEqual([10_000, 80_000, 150_000])
    expect(new Set(lines.map((line) => line.text))).toEqual(new Set(['the chorus']))
  })

  it('drops metadata tags rather than reading them as lines', () => {
    expect(parseLrc('[ar:Queen]\n[by:someone]\n[00:01.00] real')).toEqual([
      { atMs: 1_000, text: 'real' },
    ])
  })

  it('keeps an empty line, because that is an instrumental gap', () => {
    const lines = parseLrc('[00:01.00] a\n[00:09.00]\n[00:20.00] b')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toEqual({ atMs: 9_000, text: '' })
  })

  it('leaves a bracket inside the lyric alone', () => {
    expect(parseLrc('[00:01.00] oh [sic] dear')[0]?.text).toBe('oh [sic] dear')
  })

  it('sorts lines that arrive out of order', () => {
    const lines = parseLrc('[00:30.00] third\n[00:10.00] first\n[00:20.00] second')
    expect(lines.map((line) => line.text)).toEqual(['first', 'second', 'third'])
  })

  it('shifts every stamp by a positive offset, earlier', () => {
    // Pinned because the sign is not agreed across implementations; this test
    // is what stops the direction being flipped by a later reading of the spec.
    const lines = parseLrc('[offset:+500]\n[00:10.00] x')
    expect(lines[0]?.atMs).toBe(9_500)
    expect(parseLrc('[offset:-500]\n[00:10.00] x')[0]?.atMs).toBe(10_500)
  })

  it('never produces a negative time', () => {
    expect(parseLrc('[offset:+5000]\n[00:01.00] x')[0]?.atMs).toBe(0)
  })

  it('returns nothing for empty or unsynced text', () => {
    expect(parseLrc('')).toEqual([])
    expect(parseLrc('just a plain lyric sheet\nwith no timings')).toEqual([])
  })
})

describe('the active line', () => {
  const lines = parseLrc('[00:10.00] one\n[00:20.00] two\n[00:30.00] three')

  it('shows nothing before the first line leads in', () => {
    expect(activeLyricIndex(lines, 0)).toBe(-1)
    expect(activeLyricIndex(lines, 10_000 - LYRIC_LEAD_MS - 1)).toBe(-1)
  })

  it('lights a line early, by exactly the lead', () => {
    expect(activeLyricIndex(lines, 10_000 - LYRIC_LEAD_MS)).toBe(0)
    expect(activeLyricIndex(lines, 10_000)).toBe(0)
  })

  it('hands over to the next line one lead before it is sung', () => {
    expect(activeLyricIndex(lines, 20_000 - LYRIC_LEAD_MS - 1)).toBe(0)
    expect(activeLyricIndex(lines, 20_000 - LYRIC_LEAD_MS)).toBe(1)
  })

  it('holds the last line to the end of the song', () => {
    expect(activeLyricIndex(lines, 9_999_999)).toBe(2)
  })

  it('survives lines closer together than the lead', () => {
    // Two windows would overlap here; "last line whose lead has started"
    // cannot, which is why it is written that way.
    const quick = parseLrc('[00:10.00] a\n[00:10.20] b')
    expect(activeLyricIndex(quick, 9_400)).toBe(-1)
    expect(activeLyricIndex(quick, 9_600)).toBe(0)
    expect(activeLyricIndex(quick, 9_700)).toBe(1)
    expect(activeLyricIndex(quick, 10_000)).toBe(1)
  })

  it('copes with no lines and with nonsense time', () => {
    expect(activeLyricIndex([], 1_000)).toBe(-1)
    expect(activeLyricIndex(lines, Number.NaN)).toBe(-1)
  })
})
