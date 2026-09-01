/**
 * IDLE — spec §7. "Lid closed, dust cover down. The whole player is one click
 * target."
 *
 * There is no lid in M0, so the click target is a button. From M4 this screen
 * becomes the closed turntable and this button disappears; the state machine
 * transition it fires (`AUTH_STARTED`) stays exactly the same.
 */
export function IdleScreen({ busy, onConnect }: { busy: boolean; onConnect: () => void }) {
  return (
    <div className="screen screen--centered">
      <h1>Vuelta</h1>
      <p>Sign in with Spotify to mirror whatever you’re playing.</p>
      <button type="button" className="primary" disabled={busy} onClick={onConnect}>
        {busy ? 'Opening your browser…' : 'Connect to Spotify'}
      </button>
      <p style={{ fontSize: '0.85rem' }}>
        Your browser opens on Spotify’s own site. Vuelta never sees your password.
      </p>
    </div>
  )
}
