import { describe, expect, it } from 'vitest';
import { PREVIOUS_CHUNK_CHARS, splitLikePreviousModule } from '../testing/previous-module.js';
import { ChunkAssembler, MAX_TOTAL_CHUNKS } from './chunks.js';

const bigMessage = (size: number) =>
  JSON.stringify({
    type: 'mcp-response',
    id: 'query-7',
    data: { success: true, data: 'ä'.repeat(size) },
  });

const frame = (fields: Record<string, unknown>) =>
  JSON.stringify({
    type: 'chunked-message',
    chunkId: 'c',
    originalType: 'mcp-response',
    ...fields,
  });

describe('ChunkAssembler with a module of the previous generation', () => {
  it('counts in characters, so umlauts do not change where the module cuts', () => {
    const frames = splitLikePreviousModule(bigMessage(PREVIOUS_CHUNK_CHARS));
    expect(frames).toHaveLength(2);
    expect(JSON.parse(frames[0] as string).chunk).toHaveLength(PREVIOUS_CHUNK_CHARS);
    expect(splitLikePreviousModule(bigMessage(10))).toHaveLength(1);
  });

  it('puts a series back together in any order', () => {
    const original = bigMessage(120_000);
    const frames = splitLikePreviousModule(original).reverse();
    const assembler = new ChunkAssembler();
    const results = frames.map(f => assembler.accept(f));
    expect(results.slice(0, -1).every(r => r === null)).toBe(true);
    expect(results.at(-1)).toBe(original);
    expect(assembler.incomplete).toBe(0);
  });

  it('passes frames that are not chunks straight through', () => {
    expect(new ChunkAssembler().accept('{"type":"ping"}')).toBe('{"type":"ping"}');
  });

  it('drops frames the previous server would drop', () => {
    const assembler = new ChunkAssembler();
    for (const bad of [
      frame({ chunkId: '', chunkIndex: 0, totalChunks: 2, chunk: 'x' }),
      frame({ chunkIndex: 2, totalChunks: 2, chunk: 'x' }),
      frame({ chunkIndex: -1, totalChunks: 2, chunk: 'x' }),
      frame({ chunkIndex: 0, totalChunks: 2, chunk: '' }),
      frame({ chunkIndex: 0, totalChunks: MAX_TOTAL_CHUNKS + 1, chunk: 'x' }),
      frame({ chunkIndex: '0', totalChunks: 2, chunk: 'x' }),
    ]) {
      expect(assembler.accept(bad)).toBeNull();
    }
    expect(assembler.incomplete).toBe(0);
  });

  it('drops the whole series when the number of pieces changes midway', () => {
    const assembler = new ChunkAssembler();
    assembler.accept(frame({ chunkIndex: 0, totalChunks: 2, chunk: '{"type":' }));
    expect(assembler.accept(frame({ chunkIndex: 1, totalChunks: 3, chunk: '"x"}' }))).toBeNull();
    expect(assembler.incomplete).toBe(0);
  });

  it('lets a repeated piece replace the earlier one', () => {
    const assembler = new ChunkAssembler();
    assembler.accept(frame({ chunkIndex: 0, totalChunks: 2, chunk: 'garbage' }));
    assembler.accept(frame({ chunkIndex: 0, totalChunks: 2, chunk: '{"type":' }));
    expect(assembler.accept(frame({ chunkIndex: 1, totalChunks: 2, chunk: '"pong"}' }))).toBe(
      '{"type":"pong"}'
    );
  });

  it('restores the envelope when the pieces carried only the data', () => {
    const data = JSON.stringify({ success: true, data: 'x' });
    const single = frame({ chunkIndex: 0, totalChunks: 1, chunk: data, originalId: 'query-1' });
    expect(JSON.parse(new ChunkAssembler().accept(single) as string)).toEqual({
      type: 'mcp-response',
      id: 'query-1',
      data: { success: true, data: 'x' },
    });
  });

  it('drops an incomplete series after the time limit', () => {
    let now = 0;
    const assembler = new ChunkAssembler(1000, () => now);
    const [first] = splitLikePreviousModule(bigMessage(60_000));
    assembler.accept(first as string);
    expect(assembler.incomplete).toBe(1);
    now = 5000;
    assembler.accept(frame({ chunkId: 'other', chunkIndex: 0, totalChunks: 2, chunk: '{' }));
    expect(assembler.incomplete).toBe(1);
  });
});
