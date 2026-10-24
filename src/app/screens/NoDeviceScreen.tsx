/**
 * NO_DEVICE — spec §7.
 *
 * `GET /me/player` answering 204 with an empty body is not an error; it means
 * Spotify isn't running or isn't the active device. The spec is explicit that
 * this "happens constantly" and "needs a designed screen, not an error toast".
 *
 * It no longer only waits. Vuelta is a remote control, so landing here with
 * nothing to control is a dead end the app can get itself out of: on the first
 * time this screen appears in a session it opens Spotify and starts playback
 * itself, and this screen is what you watch while that happens.
 *
 * **Once per session, and only on startup.** The app reaches this state in two
 * ways that look identical from here -- Spotify was never running, or you just
 * closed it -- and a rule of "no device, so launch it" turns the second into a
 * fight you can only win by quitting Vuelta first. So the attempt is made once
 * and never again on its own; afterwards the button is yours.
 */

import { useEffect, useRef, useState } from 'react'
import type { LaunchSpotifyResult } from '../../core/contract.js'

/** What each ending says. Every one of these is silent if it is not named. */
function message(result: LaunchSpotifyResult): string {
  switch (result.kind) {
    case 'started':
      return 'Spotify is playing.'
    case 'device-already':
      return 'Spotify is available but idle. Press play there, or on another device.'
    case 'not-installed':
      return "Spotify doesn't seem to be installed on this computer."
    case 'never-appeared':
      return 'Spotify didn’t come online. If it’s open, check you are signed in to it.'
    case 'nothing-to-resume':
      return 'Spotify is connected, but there was nothing to resume. Start a track there.'
    case 'failed':
      return result.message
  }
}

export function NoDeviceScreen({ busy, onRetry }: { busy: boolean; onRetry: () => void }) {
  const [launching, setLaunching] = useState(false)
  const [outcome, setOutcome] = useState<LaunchSpotifyResult | null>(null)
  /** The once in "once per session". A ref, so a re-render cannot spend it. */
  const spent = useRef(false)

  const attempt = (): void => {
    if (launching) return
    setLaunching(true)
    setOutcome(null)
    void window.vuelta
      .launchSpotify()
      .then((result) => setOutcome(result))
      .catch(() => setOutcome({ kind: 'failed', message: 'Could not reach Spotify.' }))
      .finally(() => setLaunching(false))
  }

  useEffect(() => {
    if (spent.current) return
    spent.current = true
    attempt()
    // Deliberately once, on first mount, with no dependencies. See the note
    // at the top of the file: re-running this when the device goes away again
    // would reopen Spotify every time the user closed it.
  }, [])

  return (
    <div className="screen screen--centered">
      <h1>No turntable connected</h1>

      {launching ? (
        <p>Opening Spotify…</p>
      ) : outcome ? (
        <p>{message(outcome)}</p>
      ) : (
        <p>Open Spotify and press play.</p>
      )}

      <button type="button" disabled={busy || launching} onClick={outcome ? attempt : onRetry}>
        {launching ? 'Opening…' : busy ? 'Checking…' : outcome ? 'Try again' : 'Check again'}
      </button>
    </div>
  )
}
