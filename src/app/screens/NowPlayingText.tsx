import type { PlaybackSnapshot } from '../../core/contract.js'

/**
 * The M0 deliverable: the current track as plain text.
 *
 * No disc, no label, no tonearm. Spec §16 defines M0 as "no graphics at all",
 * and §17 explains why — design work is pleasant, which makes it an effective
 * way to avoid the part of the project that can actually fail.
 *
 * The numbers here are read straight from the poll. They will not count up:
 * local extrapolation on rAF is M1, and building it now would be building M1.
 */
function mmss(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function NowPlayingText({
  snapshot,
  busy,
  onRefresh,
}: {
  snapshot: PlaybackSnapshot | null
  busy: boolean
  onRefresh: () => void
}) {
  const track = snapshot?.track ?? null

  return (
    <div className="screen screen--centered">
      <h2>{snapshot?.isPlaying ? 'Playing' : 'Paused'}</h2>

      {track ? (
        <div className="track">
          <div className="track__title">{track.title}</div>
          <div className="track__artist">{track.artist}</div>
          <div className="track__time">
            {mmss(snapshot?.progressMs ?? 0)} / {mmss(track.durationMs)}
          </div>
        </div>
      ) : (
        <p>Something is playing, but Spotify didn’t say what. It may be a local or private track.</p>
      )}

      <button type="button" disabled={busy} onClick={onRefresh}>
        {busy ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  )
}
