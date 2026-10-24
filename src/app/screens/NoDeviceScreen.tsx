/**
 * NO_DEVICE — spec §7.
 *
 * `GET /me/player` answering 204 with an empty body is not an error; it means
 * Spotify isn't running or isn't the active device. The spec is explicit that
 * this "happens constantly" and "needs a designed screen, not an error toast".
 *
 * It no longer only waits. Vuelta is a remote control, so landing here with
 * nothing to control is a dead end the app can get itself out of: the first
 * time this screen appears in a session it fetches Spotify itself.
 *
 * The sequence it starts does not live here, though — see `useSync`. Arming
 * the device ends the no-device state, so this screen is unmounted halfway
 * through, and the lid and the music both happen after it has gone. All this
 * owns is the one-shot that starts it, and the message if it fails.
 *
 * **Once per session, and only on startup.** The app reaches this state in two
 * ways that look identical from here — Spotify was never running, or you just
 * closed it — and a rule of "no device, so launch it" turns the second into a
 * fight you can only win by quitting Vuelta first.
 */

import { useEffect, useRef } from 'react'
import type { LaunchState } from '../useSync.js'

/** What each ending says. Every one of these is silent if it is not named. */
function message(state: LaunchState): string | null {
  if (state.phase === 'running') return 'Opening Spotify…'
  if (!state.outcome) return null
  switch (state.outcome.kind) {
    case 'armed':
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
      return state.outcome.message
  }
}

export function NoDeviceScreen({
  busy,
  onRetry,
  launch,
  onLaunch,
}: {
  busy: boolean
  onRetry: () => void
  launch: LaunchState
  onLaunch: () => void
}) {
  /** The once in "once per session". A ref, so a re-render cannot spend it. */
  const spent = useRef(false)

  useEffect(() => {
    if (spent.current) return
    spent.current = true
    onLaunch()
    // Deliberately once, on first mount, with no dependencies: re-running it
    // when the device goes away again would reopen Spotify every time the
    // user closed it.
  }, [])

  const running = launch.phase === 'running'
  const said = message(launch)

  return (
    <div className="screen screen--centered">
      <h1>No turntable connected</h1>
      <p>{said ?? 'Open Spotify and press play.'}</p>
      <button
        type="button"
        disabled={busy || running}
        onClick={launch.outcome ? onLaunch : onRetry}
      >
        {running ? 'Opening…' : busy ? 'Checking…' : launch.outcome ? 'Try again' : 'Check again'}
      </button>
    </div>
  )
}
