/**
 * Anything that stopped authorization and is not the 403 case, which has its
 * own screen. The message is written by main/, which maps Spotify's wording
 * onto something actionable before it ever reaches here.
 */
export function AuthFailedScreen({
  message,
  busy,
  onRetry,
  onStartOver,
}: {
  message: string | null
  busy: boolean
  onRetry: () => void
  onStartOver: () => void
}) {
  return (
    <div className="screen screen--centered">
      <h1>Couldn’t connect</h1>
      <p>{message ?? 'Authorization did not complete.'}</p>
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
