/**
 * Putting together the chunked messages of the WebRTC detour.
 *
 * Chunks only travel one way: from a module of the previous generation to the
 * server. That module
 * serializes the whole message, cuts the text into pieces of 51200 characters
 * (UTF-16 code units, not bytes) and sends each piece as a `chunked-message`
 * frame with `chunkId`, `chunkIndex`, `totalChunks`, `chunk`, `originalType`
 * and `originalId`.
 *
 * There is deliberately no sending side. A module of the previous generation
 * throws chunk frames away, so the server sends every message in one piece, as
 * the previous server did. The module of this rewrite speaks no WebRTC.
 */

/** More pieces than this are refused, as by the previous server. */
export const MAX_TOTAL_CHUNKS = 1000;

/** How long an incomplete series is kept. The previous server kept it 30 to 40 seconds. */
export const CHUNK_SERIES_MAX_AGE_MS = 60_000;

interface ChunkFrame {
  type: 'chunked-message';
  chunkId: string;
  chunkIndex: number;
  totalChunks: number;
  chunk: string;
  originalType?: unknown;
  originalId?: unknown;
}

interface Series {
  pieces: Array<string | undefined>;
  firstSeen: number;
  originalType: string;
  originalId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The checks of the previous server. A frame that fails one is dropped without a word. */
function validFrame(frame: Record<string, unknown>): frame is Record<string, unknown> & ChunkFrame {
  const index = frame['chunkIndex'];
  const total = frame['totalChunks'];
  return (
    typeof frame['chunkId'] === 'string' &&
    frame['chunkId'] !== '' &&
    Number.isInteger(index) &&
    Number.isInteger(total) &&
    (index as number) >= 0 &&
    (index as number) < (total as number) &&
    (total as number) <= MAX_TOTAL_CHUNKS &&
    typeof frame['chunk'] === 'string' &&
    frame['chunk'] !== ''
  );
}

export class ChunkAssembler {
  private readonly series = new Map<string, Series>();

  constructor(
    private readonly maxAgeMs: number = CHUNK_SERIES_MAX_AGE_MS,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * Feed one received frame. Returns the text of a complete message, the
   * frame itself when it is not a chunk, or null while a series is incomplete
   * or the frame was dropped.
   */
  accept(text: string): string | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return text;
    }
    if (!isRecord(parsed) || parsed['type'] !== 'chunked-message') return text;

    this.dropStale();
    if (!validFrame(parsed)) return null;
    const frame = parsed;

    let series = this.series.get(frame.chunkId);
    if (series && series.pieces.length !== frame.totalChunks) {
      // The previous server drops the whole series when the count changes midway.
      this.series.delete(frame.chunkId);
      return null;
    }
    if (!series) {
      series = {
        pieces: new Array<string | undefined>(frame.totalChunks).fill(undefined),
        firstSeen: this.now(),
        originalType: typeof frame.originalType === 'string' ? frame.originalType : 'unknown',
      };
      if (typeof frame.originalId === 'string') series.originalId = frame.originalId;
      this.series.set(frame.chunkId, series);
    }
    // A repeated index replaces the earlier piece.
    series.pieces[frame.chunkIndex] = frame.chunk;
    if (series.pieces.some(piece => piece === undefined)) return null;

    this.series.delete(frame.chunkId);
    return rebuild(series.pieces.join(''), series);
  }

  get incomplete(): number {
    return this.series.size;
  }

  private dropStale(): void {
    const limit = this.now() - this.maxAgeMs;
    for (const [id, series] of this.series) {
      if (series.firstSeen < limit) this.series.delete(id);
    }
  }
}

/**
 * A joined text that already is a message stays as it is. Pieces that carried
 * only the data get their envelope back; no known module sends that, but it
 * costs nothing to accept.
 */
function rebuild(joined: string, series: Series): string {
  try {
    const parsed = JSON.parse(joined) as unknown;
    if (isRecord(parsed) && typeof parsed['type'] === 'string') return joined;
    const envelope: Record<string, unknown> = { type: series.originalType, data: parsed };
    if (series.originalId !== undefined) envelope['id'] = series.originalId;
    return JSON.stringify(envelope);
  } catch {
    return joined;
  }
}
