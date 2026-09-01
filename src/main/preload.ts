/**
 * The bridge. Runs sandboxed, with context isolation on.
 *
 * The renderer gets exactly the methods on `VueltaBridge` and nothing else —
 * no `ipcRenderer`, no `require`, no Node. Every value that crosses is a plain
 * serializable object defined in core/contract.ts.
 */

import { contextBridge, ipcRenderer } from 'electron'
import type { VueltaBridge } from '../core/contract.js'
import { CHANNELS } from './channels.js'

const bridge: VueltaBridge = {
  getSetup: () => ipcRenderer.invoke(CHANNELS.getSetup),
  saveClientId: (clientId) => ipcRenderer.invoke(CHANNELS.saveClientId, clientId),
  startAuth: () => ipcRenderer.invoke(CHANNELS.startAuth),
  signOut: () => ipcRenderer.invoke(CHANNELS.signOut),
  getPlayer: () => ipcRenderer.invoke(CHANNELS.getPlayer),
  copyText: (text) => ipcRenderer.invoke(CHANNELS.copyText, text),
}

contextBridge.exposeInMainWorld('vuelta', bridge)
