/**
 * What core needs from the outside world, stated as an interface it owns.
 *
 * `core/` cannot reach the preload bridge directly: it has no DOM, so `window`
 * does not exist here (tsconfig.core.json gives it neither the DOM lib nor
 * Node types). That is the boundary working as intended rather than an
 * obstacle — core declares the shape it depends on, and `src/app/` supplies an
 * implementation backed by `window.vuelta`.
 *
 * It also means every one of these can be replaced by a fake in a test with no
 * Electron, no network, and no renderer.
 */

import type { CommandResult, PlayerPoll } from './contract.js'

export type PlaybackPort = {
  getPlayer(): Promise<PlayerPoll>
  play(): Promise<CommandResult>
  pause(): Promise<CommandResult>
  seek(positionMs: number): Promise<CommandResult>
  next(): Promise<CommandResult>
  previous(): Promise<CommandResult>
  setVolume(percent: number): Promise<CommandResult>
}

/** Injected so tests can control time instead of waiting for it. */
export type NowFn = () => number
