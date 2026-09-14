/**
 * How a module of the previous generation behaves on the wire, for tests that
 * check the server against it. Written from a description of
 * its behaviour, not from that module's code.
 */

/** The previous module cuts messages longer than this many characters. */
export const PREVIOUS_CHUNK_CHARS = 51_200;

/**
 * Split a serialized message the way the previous module does: pieces of the
 * whole text, counted in characters, one `chunked-message` frame each.
 */
export function splitLikePreviousModule(text: string, now: number = Date.now()): string[] {
  if (text.length <= PREVIOUS_CHUNK_CHARS) return [text];

  let originalType: unknown;
  let originalId: unknown;
  try {
    const parsed = JSON.parse(text) as { type?: unknown; id?: unknown };
    originalType = parsed.type;
    originalId = parsed.id;
  } catch {
    // Kept undefined, like a message without those fields.
  }

  const chunkId = `chunk-${now}-${Math.random().toString(36).slice(2, 11).padEnd(9, '0')}`;
  const totalChunks = Math.ceil(text.length / PREVIOUS_CHUNK_CHARS);
  const frames: string[] = [];
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const start = chunkIndex * PREVIOUS_CHUNK_CHARS;
    const frame: Record<string, unknown> = {
      type: 'chunked-message',
      chunkId,
      chunkIndex,
      totalChunks,
      chunk: text.slice(start, start + PREVIOUS_CHUNK_CHARS),
      originalType,
    };
    if (typeof originalId === 'string') frame['originalId'] = originalId;
    frames.push(JSON.stringify(frame));
  }
  return frames;
}
