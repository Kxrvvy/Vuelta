/**
 * IPC channel names, in one place so main and preload cannot drift apart.
 * Deliberately free of imports — the preload runs in a sandboxed context.
 */
export const CHANNELS = {
  getSetup: 'vuelta:get-setup',
  saveClientId: 'vuelta:save-client-id',
  startAuth: 'vuelta:start-auth',
  signOut: 'vuelta:sign-out',
  getPlayer: 'vuelta:get-player',
  copyText: 'vuelta:copy-text',
} as const
