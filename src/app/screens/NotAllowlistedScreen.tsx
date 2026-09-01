import type { SetupInfo } from '../../core/contract.js'

/**
 * HTTP 403 — spec §3: "A 403 response means the user has not allowlisted
 * themselves. This will be the most common support issue. Catch it
 * specifically and show instructions, not a raw error."
 *
 * So this screen shows the fix, not the failure.
 */
export function NotAllowlistedScreen({
  setup,
  message,
  busy,
  onRetry,
  onStartOver,
}: {
  setup: SetupInfo
  message: string | null
  busy: boolean
  onRetry: () => void
  onStartOver: () => void
}) {
  return (
    <div className="screen">
      <h2>Not authorized yet</h2>
      <h1>Add yourself to your Spotify app’s user list</h1>
      <p>
        Spotify apps start in development mode, where only accounts you have explicitly listed may
        use them — including your own.
      </p>

      <ol>
        <li>
          Open your app in the{' '}
          <a href="https://developer.spotify.com/dashboard">Spotify developer dashboard</a>.
        </li>
        <li>
          Go to <strong>Settings → User Management</strong>.
        </li>
        <li>Add the full name and email address of the Spotify account you just signed in with.</li>
        <li>Come back here and try again.</li>
      </ol>

      <p style={{ fontSize: '0.85rem' }}>
        Client ID in use: <code>{setup.clientId ?? 'none'}</code>
      </p>

      {message ? <div className="notice">{message}</div> : null}

      <div className="row">
        <button type="button" className="primary" disabled={busy} onClick={onRetry}>
          Try again
        </button>
        <button type="button" className="link" onClick={onStartOver}>
          Use a different Client ID
        </button>
      </div>
    </div>
  )
}
