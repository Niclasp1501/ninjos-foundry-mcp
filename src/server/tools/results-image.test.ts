import { describe, expect, it } from 'vitest';
import type { ToolResult } from '../control/api.js';
import { toToolResult } from './results.js';

describe('image blocks in a tool result', () => {
  const finished: ToolResult = {
    content: [
      { type: 'text', text: 'x'.repeat(40) },
      { type: 'image', data: 'A'.repeat(40), mimeType: 'image/jpeg' },
    ],
  };

  it('are typed without a cast and have no text', () => {
    const image = finished.content[1];
    expect(image?.type).toBe('image');
    expect(image?.text).toBeUndefined();
  });

  it('pass through untouched when text blocks are cut', () => {
    const cut = toToolResult(finished, 10);
    expect(cut.content[0]?.text).toMatch(/^x{10}\n\n\[Truncated/);
    expect(cut.content[1]).toEqual({ type: 'image', data: 'A'.repeat(40), mimeType: 'image/jpeg' });
  });
});
