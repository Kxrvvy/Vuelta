/**
 * NO_DEVICE — spec §7.
 *
 * `GET /me/player` answering 204 with an empty body is not an error; it means
 * Spotify isn't running or isn't the active device. The spec is explicit that
 * this "happens constantly" and "needs a designed screen, not an error toast",
 * with the suggested copy used verbatim below.
 *
 * M0 checks on demand. The 3–5 second poll that makes this recover on its own
 * arrives with M1.
 */
export function NoDeviceScreen({ busy, onRetry }: { busy: boolean; onRetry: () => void }) {
  return (
    <div className="screen screen--centered">
      <h1>No turntable connected</h1>
      <p>Open Spotify and press play.</p>
      <button type="button" disabled={busy} onClick={onRetry}>
        {busy ? 'Checking…' : 'Check again'}
      </button>
    </div>
  )
}
