import { describe, expect, it } from 'vitest';
import { checkArguments } from './schema-check.js';

const schema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    count: { type: 'integer' },
    mode: { type: 'string', enum: ['a', 'b'] },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['name'],
};

describe('checkArguments', () => {
  it('accepts fitting arguments', () => {
    expect(checkArguments(schema, { name: 'x', count: 2, mode: 'a', tags: ['t'] })).toEqual([]);
  });

  it('names every problem with its path', () => {
    expect(checkArguments(schema, { count: 1.5, mode: 'c', tags: ['t', 3] })).toEqual([
      'name is required',
      'count must be integer, got number',
      'mode must be one of "a", "b"',
      'tags[1] must be string, got integer',
    ]);
  });

  it('refuses unknown parameters only when the schema says so', () => {
    expect(checkArguments(schema, { name: 'x', other: 1 })).toEqual([]);
    expect(
      checkArguments({ ...schema, additionalProperties: false }, { name: 'x', other: 1 })
    ).toEqual(['other is not a known parameter']);
  });

  it('accepts an integer where a number is expected', () => {
    expect(
      checkArguments({ type: 'object', properties: { n: { type: 'number' } } }, { n: 3 })
    ).toEqual([]);
  });

  it('holds a list to minItems', () => {
    const pages = {
      type: 'object',
      properties: { pages: { type: 'array', minItems: 1, items: { type: 'object' } } },
    };
    expect(checkArguments(pages, { pages: [] })).toEqual([
      'pages must have at least 1 entry, got 0',
    ]);
    expect(checkArguments(pages, { pages: [{}] })).toEqual([]);
  });

  it('refuses arguments that are not an object', () => {
    expect(checkArguments(schema, 'x')).toEqual(['the arguments must be an object, got string']);
  });
});
