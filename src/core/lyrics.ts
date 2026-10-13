/**
 * Lyrics: parsing LRC, and deciding which line is the current one.
 *
 * Pure and DOM-free, like everything else in core. The fetch happens in
 * main/lyrics/client.ts and the drawing in app/lyrics/; this is the part in
 * between, which is also the only part worth testing.
 *
 * The format is the ordinary one every lyrics site emits:
 *
 *     [ar:Queen]
 *     [00:00.15] Is this the real life?
 *     [00:07.13] Caught in a landslide
 *
 * A line can carry more than one timestamp, which is how a repeated chorus is
 * written once, and a file can carry metadata tags that look exactly like
 * timestamps but are not.
 */

/** One sung line, and when it starts. */
export type LyricLine = {
  atMs: number
  /** Empty for the instrumental gaps, which are worth keeping as pauses. */
  text: string
}

/**
 * How far ahead of the line a line lights up.
 *
 * This is the whole of "fades in before it is sung": the active line changes
 * early by this much, and the fade is then just a CSS transition on the class
 * that follows it. Half a second is enough to read the line before the vocal
 * lands without it looking out of time.
 */
export const LYRIC_LEAD_MS = 500

/** `[mm:ss]`, `[mm:ss.xx]` or `[mm:ss.xxx]`. Minutes may run past 59. */
const STAMP = /\[(\d+):([0-5]?\d)(?:[.:](\d{1,3}))?\]/g

/** `[offset:+250]`, in milliseconds. */
const OFFSET = /\[offset:\s*([+-]?\d+)\s*\]/i

function fractionToMs(digits: string | undefined): number {
  if (!digits) return 0
  // ".5" is five hundred milliseconds, ".05" is fifty. Pad, do not parse.
  return Number(digits.padEnd(3, '0'))
}

/**
 * LRC text to lines, sorted by time.
 *
 * Unknown tags are dropped rather than guessed at. The one exception is
 * `[offset:]`, which shifts every stamp.
 *
 * The sign convention for offset is not actually agreed between
 * implementations. The original format's note - "+ shifts time up" - is read
 * here the way most players read it: a positive offset makes the lyrics
 * arrive *earlier*, so it is subtracted. It is rare enough in practice that
 * the test below exists mostly to stop the direction being flipped by
 * accident later.
 */
export function parseLrc(text: string): LyricLine[] {
  if (!text) return []

  const offsetMatch = OFFSET.exec(text)
  const offsetMs = offsetMatch?.[1] ? Number(offsetMatch[1]) : 0

  const lines: LyricLine[] = []

  for (const raw of text.split(/\r?\n/)) {
    STAMP.lastIndex = 0

    const stamps: number[] = []
    let match: RegExpExecArray | null
    let end = 0
    while ((match = STAMP.exec(raw)) !== null) {
      // Stamps only count while they are still a run at the head of the line.
      // A bracket later on is part of the lyric, not a cue.
      if (match.index !== end) break
      end = STAMP.lastIndex
      const [, minutes, seconds, fraction] = match
      stamps.push(
        Number(minutes) * 60_000 + Number(seconds) * 1000 + fractionToMs(fraction),
      )
    }

    if (stamps.length === 0) continue

    const body = raw.slice(end).trim()
    for (const stamp of stamps) {
      lines.push({ atMs: Math.max(0, stamp - offsetMs), text: body })
    }
  }

  // Files are usually in order, and are not reliably so once a chorus has been
  // written with several stamps on one line.
  return lines.sort((a, b) => a.atMs - b.atMs)
}

/**
 * Which line is current at `ms`, or -1 before the first one.
 *
 * Expressed as "the last line whose lead has started" rather than as a window
 * per line, which matters when two lines are closer together than the lead:
 * windows would overlap and have to be resolved, this cannot.
 *
 * Called once per animation frame, over a few hundred lines at most, so a
 * scan is cheaper than anything cleverer.
 */
export function activeLyricIndex(
  lines: readonly LyricLine[],
  ms: number,
  leadMs: number = LYRIC_LEAD_MS,
): number {
  if (!Number.isFinite(ms)) return -1

  let found = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) break
    if (line.atMs - leadMs > ms) break
    found = i
  }
  return found
}
