import { afterEach, describe, expect, it } from 'vitest';
import type { ToolResult } from '../../../server/control/api.js';
import { openPf2eWorld, type Pf2eWorld, type Pf2eWorldOptions } from './testing.js';

let world: Pf2eWorld | null = null;
afterEach(() => {
  world?.close();
  world = null;
});

function open(options: Pf2eWorldOptions = {}): Pf2eWorld {
  world = openPf2eWorld(options);
  return world;
}

type Json = Record<string, any>;
const text = (result: ToolResult) =>
  result.content.map(block => (block.type === 'text' ? block.text : '')).join('');
const json = (result: ToolResult): Json => {
  if (result.isError) throw new Error(`tool failed: ${text(result)}`);
  return JSON.parse(text(result)) as Json;
};
const conditionsOf = (w: Pf2eWorld, name: string) =>
  (
    (w.foundry
      .collection('Actor')
      .find(entry => entry['name'] === name)
      ?.toObject()['items'] as Json[]) ?? []
  )
    .filter(item => item['type'] === 'condition')
    .map(item => [item['system'].slug, item['system'].value.value]);

describe('pf2e-manage-conditions', () => {
  it('sets frightened 2, raises it, lowers it and removes it at 0, each read back and logged', async () => {
    const w = open();
    const set = json(
      await w.harness.call('pf2e-manage-conditions', {
        actorIdentifier: 'Goblin Warrior',
        action: 'set',
        condition: 'Frightened',
        value: 2,
      })
    );
    expect(set).toMatchObject({
      changed: true,
      before: 'absent',
      after: '2',
      condition: 'frightened',
    });
    expect(conditionsOf(w, 'Goblin Warrior')).toEqual([['frightened', 2]]);
    expect(
      json(
        await w.harness.call('pf2e-manage-conditions', {
          actorIdentifier: 'Goblin Warrior',
          action: 'increase',
          condition: 'frightened',
        })
      )
    ).toMatchObject({ after: '3' });
    expect(
      json(
        await w.harness.call('pf2e-manage-conditions', {
          actorIdentifier: 'Goblin Warrior',
          action: 'decrease',
          condition: 'frightened',
          amount: 3,
        })
      )
    ).toMatchObject({ after: 'absent' });
    expect(conditionsOf(w, 'Goblin Warrior')).toEqual([]);
    expect(
      w.harness.changeLog.list().filter(entry => entry.query === 'pf2eManageConditions')
    ).toHaveLength(3);
  });

  it('toggles an unvalued condition, calls flat-footed off-guard, and reports no change when there is none', async () => {
    const w = open();
    expect(
      json(
        await w.harness.call('pf2e-manage-conditions', {
          actorIdentifier: 'Valeria',
          action: 'toggle',
          condition: 'flat-footed',
        })
      )
    ).toMatchObject({ condition: 'off-guard', after: 'present' });
    expect(
      json(
        await w.harness.call('pf2e-manage-conditions', {
          actorIdentifier: 'Valeria',
          action: 'set',
          condition: 'off-guard',
          value: 2,
        })
      )
    ).toMatchObject({
      changed: false,
      ignoredParameters: ['value'],
    });
  });

  it('writes the value itself when pf2e creates the condition without it', async () => {
    const w = open({ ignoreValueOnCreate: true });
    json(
      await w.harness.call('pf2e-manage-conditions', {
        actorIdentifier: 'Goblin Warrior',
        action: 'set',
        condition: 'sickened',
        value: 3,
      })
    );
    expect(conditionsOf(w, 'Goblin Warrior')).toEqual([['sickened', 3]]);
  });

  it('lists conditions without the write switch', async () => {
    const w = open({ settings: { 'ninjos-foundry-mcp.allowWriteOperations': false } });
    expect(
      json(
        await w.harness.call('pf2e-manage-conditions', {
          actorIdentifier: 'Cult Fanatic',
          action: 'list',
        })
      )
    ).toMatchObject({
      count: 1,
      conditions: [{ slug: 'frightened', value: 2 }],
    });
    const result = await w.harness.call('pf2e-manage-conditions', {
      actorIdentifier: 'Cult Fanatic',
      action: 'remove',
      condition: 'frightened',
    });
    expect(result.isError).toBe(true);
    expect(w.foundry.operations).toEqual([]);
  });

  it('names the cause: unknown condition, missing condition, other system, actor of another system', async () => {
    let w = open();
    expect(
      text(
        await w.harness.call('pf2e-manage-conditions', {
          actorIdentifier: 'Valeria',
          action: 'set',
          condition: 'sleepy',
        })
      )
    ).toMatch(/"sleepy" is not a Pathfinder 2e condition. Conditions: blinded/);
    expect(
      text(
        await w.harness.call('pf2e-manage-conditions', {
          actorIdentifier: 'Valeria',
          action: 'set',
        })
      )
    ).toMatch(/condition is required/);
    w.close();
    w = open({ system: { id: 'dnd5e', version: '5.3.3' } });
    expect(
      text(
        await w.harness.call('pf2e-manage-conditions', {
          actorIdentifier: 'Valeria',
          action: 'list',
        })
      )
    ).toMatch(/requires the game system "pf2e". Detected game system: "dnd5e"/);
    w.close();
    w = open({ withoutConditionMethods: true });
    expect(
      text(
        await w.harness.call('pf2e-manage-conditions', {
          actorIdentifier: 'Valeria',
          action: 'set',
          condition: 'prone',
        })
      )
    ).toMatch(/does not look like a pf2e actor. Nothing was changed/);
    world = w;
  });
});

describe('the neutral tools with the pf2e adapter', () => {
  it('get-character shows ancestry, class, ranks and the computed note', async () => {
    const w = open();
    const answer = text(await w.harness.call('get-character', { identifier: 'Valeria' }));
    expect(answer).toContain('Versatile Human');
    expect(answer).toMatch(/"keyAttribute":\s*"str"/);
    expect(answer).toContain('Rule elements');
  });

  it('search-character-items knows the pf2e categories', async () => {
    const w = open();
    const answer = json(
      await w.harness.call('search-character-items', {
        characterIdentifier: 'Valeria',
        category: 'invested',
      })
    );
    expect(answer['matches'].map((match: Json) => match['name'])).toEqual(['Ring of Sustenance']);
    const refused = await w.harness.call('search-character-items', {
      characterIdentifier: 'Valeria',
      category: 'prepared',
    });
    expect(text(refused)).toMatch(/cantrip.*focus.*invested/);
  });

  it('list-creatures-by-criteria filters by level and traits through the creature index', async () => {
    const w = open();
    const answer = text(
      await w.harness.call('list-creatures-by-criteria', {
        level: { min: -1, max: 0 },
        traits: ['goblin'],
      })
    );
    expect(answer).toContain('Goblin Warrior');
    expect(answer).not.toContain('Cult Fanatic');
  });
});
