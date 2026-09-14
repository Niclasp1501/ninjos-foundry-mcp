/**
 * Names and paths of scenes, without Foundry.
 *
 * Pure functions, shared by module and tests, so the rules for readable
 * names, navigation labels, media paths and folder paths exist once.
 */

/** "SC_Hafen_Nacht" becomes "SC Hafen Nacht": underscores turn into spaces. */
export function readableName(name: string): string {
  return name.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** "SC_Hafen_Nacht" becomes "Hafen Nacht": the SC_ or BM_ prefix is dropped, underscores turn into spaces. */
export function derivedNavName(name: string): string {
  return readableName(name.trim().replace(/^(SC|BM)_/i, ''));
}

const URL_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Encode a media path for Foundry, but only once.
 *
 * A path that is already encoded is decoded first and encoded again, which
 * leaves it as it was; a raw path gets encoded. A literal percent sign that
 * is not an escape makes decoding fail, so such a path counts as raw.
 */
export function encodeMediaPath(path: string): string {
  const trimmed = path.trim();
  let decoded = trimmed;
  try {
    decoded = decodeURI(trimmed);
  } catch {
    decoded = trimmed;
  }
  const encoded = encodeURI(decoded);
  if (URL_PATTERN.test(trimmed)) return encoded;
  return encoded.replace(/#/g, '%23').replace(/\?/g, '%3F');
}

/** The readable form of a media path, for messages and comparisons. */
export function decodeMediaPath(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

/** "Locations/Harbour" becomes ["Locations", "Harbour"]. Empty segments are dropped; an empty path means no folder. */
export function splitFolderPath(path: string): string[] {
  return path
    .split('/')
    .map(part => part.trim())
    .filter(part => part.length > 0);
}

const VIDEO_EXTENSIONS = new Set(['webm', 'mp4', 'm4v', 'ogv', 'ogg', 'mov']);

/** Whether a media path points at a video, judged by its extension. */
export function isVideoPath(path: string): boolean {
  const clean = path.split(/[?#]/)[0] ?? '';
  const extension = clean.slice(clean.lastIndexOf('.') + 1).toLowerCase();
  return VIDEO_EXTENSIONS.has(extension);
}
