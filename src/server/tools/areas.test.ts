import { describe, expect, it } from 'vitest';
import { MODULE_AREAS } from '../../module/areas/index.js';
import { SERVER_AREAS } from '../areas/index.js';
import { installServerAreas, type ServerArea } from './areas.js';
import { PromptRegistry, ResourceRegistry } from './resources.js';
import { readOnlyTool, type ToolDefinition } from './types.js';

const tool = (name: string): ToolDefinition => ({
  name,
  title: name,
  description: 'Test tool.',
  group: 'world',
  inputSchema: { type: 'object' },
  annotations: readOnlyTool(name),
  handler: async () => 'ok',
});

function targets() {
  const names: string[] = [];
  return {
    names,
    tools: { register: (t: ToolDefinition) => void names.push(t.name) },
    resources: new ResourceRegistry(),
    prompts: new PromptRegistry(),
  };
}

describe('installServerAreas', () => {
  it('registers the contributions of every area', () => {
    const t = targets();
    installServerAreas(
      [
        { id: 'a', tools: [tool('one')] },
        { id: 'b', tools: [tool('two')] },
      ],
      t
    );
    expect(t.names).toEqual(['one', 'two']);
  });

  it('names both owners when two areas claim the same tool', () => {
    const areas: ServerArea[] = [
      { id: 'journals', tools: [tool('list-journals')] },
      { id: 'world', tools: [tool('list-journals')] },
    ];
    expect(() => installServerAreas(areas, targets())).toThrow(
      'The tool "list-journals" of area "world" is already registered by area "journals"'
    );
  });

  it('refuses an area listed twice', () => {
    const area: ServerArea = { id: 'maps' };
    expect(() => installServerAreas([area, area], targets())).toThrow('listed twice');
  });
});

describe('the area lists', () => {
  it('have the same 22 areas in the same order on both sides', () => {
    const ids = [
      'journals',
      'scenes',
      'compendiums',
      'world',
      'interface',
      'actors',
      'dnd5e',
      'tokens-dice',
      'effects-playback',
      'campaign',
      'maps',
      'combat-rolls',
      'chat-tables-macros',
      'canvas',
      'scene-image',
      'world-files-decks',
      'generic-access',
      'pf2e',
      'dsa5',
      'wfrp4e-cosmere-traveller',
      'mcp-extras',
      'preview-undo',
    ];
    expect(SERVER_AREAS.map(a => a.id)).toEqual(ids);
    expect(MODULE_AREAS.map(a => a.id)).toEqual(SERVER_AREAS.map(a => a.id));
  });

  it('install without a conflict', () => {
    expect(() => installServerAreas(SERVER_AREAS, targets())).not.toThrow();
  });
});
