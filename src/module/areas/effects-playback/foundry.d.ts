/**
 * The Foundry documents the effects-playback area reads and writes, narrowed from the loose
 * core types. Global script without import or export.
 *
 * Reference fields (`folder`, `playlist`, `playlistSound`) are `unknown`:
 * Foundry holds an id in the source data and may hand out the document on the
 * prepared one. They are read through `idOf` from the world area.
 */

interface FoundryEffectsPlaybackEffect extends FoundryDocument {
  name: string;
}

interface FoundryEffectsPlaybackItem extends FoundryDocument {
  name: string;
  effects: FoundryCollection<FoundryEffectsPlaybackEffect>;
}

interface FoundryEffectsPlaybackActor extends FoundryDocument {
  name: string;
  items: FoundryCollection<FoundryEffectsPlaybackItem>;
  effects: FoundryCollection<FoundryEffectsPlaybackEffect>;
}

interface FoundryEffectsPlaybackSound extends FoundryDocument {
  name: string;
  path?: unknown;
  volume?: unknown;
  repeat?: unknown;
  fade?: unknown;
  playing?: unknown;
}

/** Playback methods are optional: a Foundry without them is reported, not called blindly. */
interface FoundryEffectsPlaybackPlaylist extends FoundryDocument {
  name: string;
  mode?: unknown;
  playing?: unknown;
  description?: unknown;
  folder?: unknown;
  sort?: unknown;
  sorting?: unknown;
  channel?: unknown;
  fade?: unknown;
  sounds: FoundryCollection<FoundryEffectsPlaybackSound>;
  playAll?: () => Promise<unknown>;
  stopAll?: () => Promise<unknown>;
  cycleMode?: () => Promise<unknown>;
  playSound?: (sound: FoundryEffectsPlaybackSound) => Promise<unknown>;
  stopSound?: (sound: FoundryEffectsPlaybackSound) => Promise<unknown>;
}

interface FoundryEffectsPlaybackScene extends FoundryDocument {
  name: string;
  playlist?: unknown;
  playlistSound?: unknown;
}

interface FoundryEffectsPlaybackFolder extends FoundryDocument {
  name: string;
  type?: unknown;
}
