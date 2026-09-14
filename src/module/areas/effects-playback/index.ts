/**
 * Area effects-playback: effects, playlist control, scene music, replacing a page.
 *
 * Module side: query handlers of the package. No settings, no visible texts.
 *
 * Query names: the camel case spelling this server sends, and the original's
 * spelling (hyphens for the playlist queries). No server of ours ever sent
 * them, so both are free to take.
 * `updateJournalContent` and `getJournalPageContent` stay unregistered; the
 * query for replace-journal-page is `replaceJournalPage`, and the server
 * falls back to the old pair only for a module of the previous generation.
 */
import type { ModuleArea } from '../../areas.js';
import { manageEffects } from './effects.js';
import { replaceJournalPage } from './journal-page.js';
import { controlPlaylist } from './playback.js';
import { managePlaylists } from './playlists.js';
import { updateSceneMusic } from './scene-music.js';

export const effectsPlaybackArea: ModuleArea = {
  id: 'effects-playback',
  queries: [
    { names: 'manageEffects', handler: manageEffects },
    { names: ['managePlaylists', 'manage-playlists'], handler: managePlaylists },
    { names: ['controlPlaylist', 'control-playlist'], handler: controlPlaylist },
    { names: ['updateSceneMusic', 'update-scene-music'], handler: updateSceneMusic },
    { names: 'replaceJournalPage', handler: replaceJournalPage },
  ],
  settings: [],
};
