import { describe, expect, it } from 'vitest';
import { boxOf, differences, holds, prepareElement, summarize } from './elements.js';

describe('preparing elements', () => {
  it('turns wall words into Foundry numbers', () => {
    const { data, problems } = prepareElement(
      'wall',
      {
        c: [0, 0, 100, 0],
        door: 'secret',
        doorState: 'locked',
        sight: 'Limited',
        dir: 'left',
        move: 20,
      },
      'create'
    );
    expect(problems).toEqual([]);
    expect(data).toEqual({ c: [0, 0, 100, 0], door: 2, ds: 2, sight: 10, dir: 1, move: 20 });
  });

  it('names every problem of an entry', () => {
    expect(
      prepareElement('wall', { c: [1, 2, 3], door: 'gate', move: 'limited' }, 'create').problems
    ).toEqual([
      'move "limited" is not one of none, normal',
      'door "gate" is not one of none, door, secret',
      'c must be four numbers [x0, y0, x1, y1] in pixels',
    ]);
    expect(prepareElement('sound', { x: 1, y: 2, radius: 0 }, 'create').problems).toEqual([
      'radius must be larger than 0',
      'path must be the audio file, e.g. "sounds/rain.ogg"',
    ]);
    expect(prepareElement('region', { name: 'x' }, 'create').problems[0]).toMatch(
      /^shapes must be a list/
    );
    expect(prepareElement('tile', { x: 0, y: 0, width: 1, height: 1 }, 'create').problems).toEqual([
      'texture.src must be the image file of the tile',
    ]);
  });

  it('refuses operators, Foundry fields and the own markers', () => {
    const { problems } = prepareElement(
      'light',
      {
        _id: 'x',
        'config.-=dim': null,
        flags: { 'ninjos-foundry-mcp': { createdByMcp: false } },
        _stats: {},
      },
      'update'
    );
    expect(problems).toHaveLength(4);
    expect(problems[0]).toMatch(/goes into "id"/);
    expect(problems.join(' ')).toMatch(/operators/);
    expect(problems.join(' ')).toMatch(/markers of Ninjo's Foundry MCP/);
    expect(prepareElement('light', {}, 'update').problems).toEqual(['changes is empty']);
    expect(prepareElement('wall', { ds: 1, door: 0 }, 'update').problems[0]).toMatch(
      /door state needs door/
    );
  });
});

describe('reading back', () => {
  it('compares the asked keys only, lists entry by entry', () => {
    expect(holds({ a: 1 }, { a: 1, b: 2 })).toBe(true);
    expect(holds([{ type: 'x' }], [{ type: 'x', _id: 'q' }])).toBe(true);
    expect(holds([{ type: 'x' }], [])).toBe(false);
    expect(holds(0.1 + 0.2, 0.3)).toBe(true);
    expect(holds(null, undefined)).toBe(true);
    expect(
      differences({ 'config.dim': 40, hidden: true }, { config: { dim: 30 }, hidden: true })
    ).toEqual([{ path: 'config.dim', requested: 40, stored: 30 }]);
  });

  it('places regions by their shapes and summarizes walls in words', () => {
    expect(
      boxOf('region', {
        shapes: [
          { type: 'rectangle', x: 10, y: 20, width: 30, height: 40 },
          { type: 'polygon', points: [0, 0, 5, 100] },
        ],
      })
    ).toEqual({ x: 0, y: 0, width: 40, height: 100 });
    expect(
      summarize('wall', { _id: 'w', c: [0, 0, 1, 1], door: 1, ds: 2, move: 20, sight: 10, dir: 0 })
    ).toEqual({
      id: 'w',
      c: [0, 0, 1, 1],
      door: 'door',
      doorState: 'locked',
      move: 'normal',
      sight: 'limited',
      light: 'default',
      sound: 'default',
      direction: 'both',
    });
  });
});
