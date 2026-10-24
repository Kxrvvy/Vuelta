/**
 * Opening the Spotify desktop client and starting it.
 *
 * Vuelta is a remote control, so it needs something to control. When it starts
 * and there is nothing there, this fetches the deck: it opens Spotify, waits
 * for it to register itself with the account, and transfers playback to it.
 *
 * In `main/` because both halves belong here -- `shell` is the only way out to
 * the desktop, and every HTTP call in the app lives in this layer.
 *
 * Nothing here retries on its own. The renderer runs it once per launch and
 * offers a button afterwards; that decision is the user's, not this module's.
 */

import { shell } from 'electron'
import type { LaunchSpotifyResult } from '../../core/contract.js'
import { getPlayer, listDevices, transferTo } from './client.js'

/**
 * The URI the desktop client registers on Windows.
 *
 * Checked on this machine: `HKEY_CLASSES_ROOT\spotify` is `URL:spotify`. Where
 * Spotify is not installed nothing claims it, and `openExternal` rejects --
 * which is the only way we get to tell "not installed" from "slow to start".
 */
const SPOTIFY_URI = 'spotify:'

/** How long to wait for a launched client to register as a device. */
const APPEAR_TIMEOUT_MS = 25_000

/** How often to ask whether it has appeared yet. */
const POLL_EVERY_MS = 900

/**
 * After the transfer, how long to let playback actually begin.
 *
 * The transfer can succeed against an account with nothing to resume: control
 * moves to the device and no music follows. That reads as a hang unless it is
 * checked for and named, so this is the grace period before calling it.
 */
const PLAY_GRACE_MS = 2_500

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * A device we can actually hand playback to.
 *
 * Spotify reports devices without ids in some states, and a transfer needs
 * one, so those are no use here however promising their name.
 */
function usable(devices: { id: string | null; name: string }[]): string | null {
  return devices.find((device) => typeof device.id === 'string' && device.id.length > 0)?.id ?? null
}

export async function launchSpotify(clientId: string): Promise<LaunchSpotifyResult> {
  // Something is already there -- an idle phone, another desktop -- so leave
  // it alone. Launching a second player on top of a device the user already
  // has available is presumptuous, and this is the one case where doing
  // nothing is the right answer.
  if (usable(await listDevices(clientId)) !== null) return { kind: 'device-already' }

  try {
    await shell.openExternal(SPOTIFY_URI)
  } catch {
    return { kind: 'not-installed' }
  }

  // Wait for the client to come up and tell Spotify it exists. This is the
  // slow part and its length is not ours to control: a cold start on a busy
  // machine is seconds, and a client that is installed but signed out never
  // arrives at all, which is why there is a ceiling rather than a loop.
  const until = Date.now() + APPEAR_TIMEOUT_MS
  let deviceId: string | null = null
  while (Date.now() < until) {
    await wait(POLL_EVERY_MS)
    deviceId = usable(await listDevices(clientId))
    if (deviceId !== null) break
  }
  if (deviceId === null) return { kind: 'never-appeared' }

  const moved = await transferTo(clientId, deviceId)
  if (!moved.ok) return { kind: 'failed', message: moved.message }

  // Transferred, but is it playing? An account with nothing to resume says
  // yes to the transfer and then sits silent.
  await wait(PLAY_GRACE_MS)
  const poll = await getPlayer(clientId)
  if (poll.kind === 'ok' && poll.snapshot.isPlaying) return { kind: 'started' }
  return { kind: 'nothing-to-resume' }
}
