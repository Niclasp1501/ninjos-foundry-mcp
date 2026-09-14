import { describe, expect, it } from 'vitest';
import { MODULE_ID } from '../../constants.js';
import { planUpdate } from './paths.js';
import {
  protectedFieldProblems,
  REFUSED_TYPES,
  SPECIALISED_TOOLS,
  specialisedToolsFor,
} from './rules.js';

describe('protected fields', () => {
  const before = {
    _id: 'a1',
    type: 'npc',
    ownership: { default: 0 },
    flags: { [MODULE_ID]: { createdByMcp: true }, other: {} },
    items: [],
  };

  it('allows plain fields and names every protected one a write touches', () => {
    expect(protectedFieldProblems('Actor', 'update', before, { ...before, name: 'x' })).toEqual([]);
    const problems = protectedFieldProblems('Actor', 'update', before, {
      ...before,
      _id: 'other',
      type: 'character',
      ownership: { default: 3 },
    });
    expect(problems).toHaveLength(3);
    expect(problems.join(' ')).toContain('assign-actor-ownership');
  });

  it('notices own flags removed through replace or remove', () => {
    const replaced = planUpdate(before, { changes: { flags: {} }, replace: ['flags'] });
    expect(protectedFieldProblems('Actor', 'update', before, replaced.expected)).toEqual([
      expect.stringContaining(`flags.${MODULE_ID}`),
    ]);
    const removed = planUpdate(before, { remove: [`flags.${MODULE_ID}`] });
    expect(protectedFieldProblems('Actor', 'update', before, removed.expected)).toHaveLength(1);
  });

  it('keeps embedded collections, the active scene and chat recipients out of reach', () => {
    expect(
      protectedFieldProblems(
        'Actor',
        'update',
        before,
        { ...before, items: [{}] },
        { Item: 'items' }
      )
    ).toEqual([expect.stringContaining('parentUuid')]);
    expect(protectedFieldProblems('Scene', 'create', {}, { active: true })).toHaveLength(1);
    expect(
      protectedFieldProblems('ChatMessage', 'update', { whisper: ['a'] }, { whisper: [] })
    ).toHaveLength(1);
    expect(protectedFieldProblems('Actor', 'create', {}, { type: 'npc' })).toEqual([]);
  });

  it('refuses settings entirely and names specialised tools', () => {
    expect(REFUSED_TYPES['Setting']?.read).toBe(true);
    expect(REFUSED_TYPES['User']?.read).toBe(false);
    expect(specialisedToolsFor('Actor')).toContain('manage-actors');
    expect(specialisedToolsFor('MeasuredTemplate')).toEqual([]);
  });

  it('names the canvas tools of the canvas area for the elements on a scene', () => {
    for (const kind of ['Wall', 'AmbientLight', 'AmbientSound', 'Region', 'Tile', 'Drawing']) {
      expect(specialisedToolsFor(kind)).toEqual(
        expect.arrayContaining([
          'list-canvas-elements',
          'create-canvas-elements',
          'update-canvas-elements',
          'delete-canvas-elements',
        ])
      );
    }
    expect(specialisedToolsFor('Wall')).toEqual(
      expect.arrayContaining(['set-door-state', 'check-wall-collision'])
    );
  });

  it('names only tools that exist on the server', async () => {
    const { SERVER_AREAS } = await import('../../../server/areas/index.js');
    const names = new Set(SERVER_AREAS.flatMap(area => (area.tools ?? []).map(tool => tool.name)));
    const unknown = Object.entries(SPECIALISED_TOOLS).flatMap(([kind, tools]) =>
      tools.filter(tool => !names.has(tool)).map(tool => `${kind}: ${tool}`)
    );
    expect(unknown).toEqual([]);
  });
});
