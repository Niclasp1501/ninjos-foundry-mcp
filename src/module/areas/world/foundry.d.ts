/**
 * The Foundry documents the world area reads and writes, narrowed from the loose
 * core types. Global script without import or export.
 *
 * Fields that point at another document (`folder`, `playlist`,
 * `playlistSound`) are typed `unknown`: depending on the Foundry version and
 * on whether the source or the prepared document is read, they hold the id or
 * the document itself. The area reads them through `idOf` in lookup.ts.
 */

interface FoundryWorldScene extends FoundryDocument {
  name: string;
  playlist?: unknown;
  playlistSound?: unknown;
}

interface FoundryWorldPlaylist extends FoundryDocument {
  name: string;
  mode?: unknown;
  playing?: unknown;
  folder?: unknown;
  sounds: FoundryCollection<FoundryWorldPlaylistSound>;
}

interface FoundryWorldPlaylistSound extends FoundryDocument {
  name: string;
  path?: unknown;
  repeat?: unknown;
  volume?: unknown;
}

interface FoundryWorldRollTable extends FoundryDocument {
  name: string;
  formula?: unknown;
  folder?: unknown;
  results: FoundryCollection<FoundryWorldTableResult>;
}

interface FoundryWorldTableResult extends FoundryDocument {
  range?: unknown;
  weight?: unknown;
  description?: unknown;
  text?: unknown;
}
