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

  // Playback control. Each is a round trip to Spotify's servers, which relay
  // to the desktop client — Vuelta plays no audio of its own.
  launchSpotify: 'vuelta:launch-spotify',
  play: 'vuelta:play',
  pause: 'vuelta:pause',
  seek: 'vuelta:seek',
  next: 'vuelta:next',
  previous: 'vuelta:previous',
  setVolume: 'vuelta:set-volume',

  // Playlists and the queue. User-triggered reads, cached in the renderer.
  getPlaylists: 'vuelta:get-playlists',
  getPlaylistTracks: 'vuelta:get-playlist-tracks',
  getQueue: 'vuelta:get-queue',
  playContext: 'vuelta:play-context',
  addToQueue: 'vuelta:add-to-queue',

  // Lyrics, from LRCLIB rather than Spotify. One fetch per track, and only
  // while the lyrics view is open.
  getLyrics: 'vuelta:get-lyrics',
} as const
