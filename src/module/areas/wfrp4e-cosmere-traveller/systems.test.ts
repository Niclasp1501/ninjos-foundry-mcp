import { afterEach, describe, expect, it } from 'vitest';
import type { ToolResult } from '../../../server/control/api.js';
import { openSystemWorld, type SystemKind, type SystemWorld } from './testing.js';

let world: SystemWorld | null = null;
afterEach(() => {
  world?.close();
  world = null;
});

function open(kind: SystemKind, options: Parameters<typeof openSystemWorld>[1] = {}): SystemWorld {
  world = openSystemWorld(kind, options);
  return world;
}

type Json = Record<string, any>;
const text = (result: ToolResult) =>
  result.content.map(block => (block.type === 'text' ? block.text : '')).join('');
const json = (result: ToolResult): Json => {
  if (result.isError) throw new Error(`tool failed: ${text(result)}`);
  return JSON.parse(text(result)) as Json;
};
const stored = (w: SystemWorld, name: string): Json =>
  w.foundry
    .collection('Actor')
    .find(entry => entry['name'] === name)
    ?.toObject() as Json;
const item = (actor: Json, name: string): Json | undefined =>
  (actor['items'] as Json[]).find(entry => entry['name'] === name);

describe('wfrp4e-update-actor', () => {
  it('writes characteristics, wounds, skills and the career, reads them back and records the change', async () => {
    const w = open('wfrp4e');
    const answer = json(
      await w.harness.call('wfrp4e-update-actor', {
        actor: 'brunhilde eisenfaust',
        characteristics: { ws: { advances: 10 }, t: { modifier: -5 } },
        wounds: { value: 9 },
        skills: [
          { name: 'Perception', advances: 15 },
          { name: 'Swim', advances: 2 },
        ],
        career: 'Rat Catcher',
        movement: 4,
      })
    );
    expect(answer).toMatchObject({
      success: true,
      actor: { name: 'Brunhilde Eisenfaust', via: 'name' },
      mismatches: [],
    });
    expect(answer['newCharacteristicTotals'].ws).toEqual({ value: 52, bonus: 5, computed: true });
    expect(answer['newCharacteristicTotals'].t).toMatchObject({ value: 44, bonus: 4 });
    expect(answer['warnings'].join(' ')).toMatch(/Skill "Swim" is not on the actor/);
    const actor = stored(w, 'Brunhilde Eisenfaust');
    expect(actor['system'].characteristics.ws.advances).toBe(10);
    expect(actor['system'].status.wounds).toEqual({ value: 9, max: 15 });
    expect(actor['system'].details.move.value).toBe(4);
    expect(item(actor, 'Perception')?.['system'].advances.value).toBe(15);
    expect(item(actor, 'Rat Catcher')?.['system'].current.value).toBe(true);
    expect(item(actor, 'Soldier')?.['system'].current.value).toBe(false);
    expect(w.harness.changeLog.list().some(entry => entry.query === 'updateWfrp4eActor')).toBe(
      true
    );
  });

  it('stops at the write switch before anything is written', async () => {
    const w = open('wfrp4e', { settings: { 'ninjos-foundry-mcp.allowWriteOperations': false } });
    const result = await w.harness.call('wfrp4e-update-actor', {
      actor: 'Brunhilde Eisenfaust',
      movement: 5,
    });
    expect(result.isError).toBe(true);
    expect(w.foundry.operations).toEqual([]);
  });

  it('refuses in another game system and names it', async () => {
    const w = open('cosmere');
    const result = await w.harness.call('wfrp4e-update-actor', { actor: 'Veyla', movement: 5 });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(
      /requires the game system "wfrp4e". Detected game system: "cosmere-rpg"/
    );
  });

  it('fails with the cause when nothing valid is left, and changes nothing', async () => {
    const w = open('wfrp4e');
    const result = await w.harness.call('wfrp4e-update-actor', {
      actor: 'Brunhilde Eisenfaust',
      career: 'Wizard',
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/No valid fields to update.*Career "Wizard" is not on the actor/);
    expect(w.foundry.operations).toEqual([]);
    const empty = await w.harness.call('wfrp4e-update-actor', { actor: 'Brunhilde Eisenfaust' });
    expect(text(empty)).toMatch(/Nothing to update: provide characteristics/);
  });
});

describe('wfrp4e-add-items', () => {
  it('copies from wfrp4e-core first, uses grouped templates, adds blanks visibly and switches the career', async () => {
    const w = open('wfrp4e');
    const answer = json(
      await w.harness.call('wfrp4e-add-items', {
        actor: 'wfrpBrunhilde01',
        items: [
          { name: 'Entertain (Taunt)', advances: 5 },
          { name: 'Hand Axe', quantity: 2 },
          { name: 'Scout', setCurrent: true },
          { name: 'Lute', type: 'trapping' },
          { name: 'Blessed' },
          { name: 'Perception' },
        ],
      })
    );
    expect(answer['added']).toEqual([
      expect.objectContaining({
        name: 'Entertain (Taunt)',
        type: 'skill',
        source: 'wfrp4e-core.items (grouped template)',
        advances: 5,
        total: 27,
        characteristic: 'fel',
      }),
      expect.objectContaining({
        name: 'Hand Axe',
        type: 'weapon',
        source: 'wfrp4e-core.items',
        quantity: 2,
      }),
      expect.objectContaining({ name: 'Scout', type: 'career', current: true }),
      expect.objectContaining({
        name: 'Lute',
        type: 'trapping',
        source: 'custom (not in compendium)',
      }),
    ]);
    expect(answer).toMatchObject({ complete: false, notFound: ['Lute'], mismatches: [] });
    expect(answer['ambiguous']).toEqual([
      expect.objectContaining({ name: 'Blessed', reason: expect.stringMatching(/talent, trait/) }),
    ]);
    expect(answer['skipped']).toEqual([expect.objectContaining({ name: 'Perception' })]);
    expect(answer['warnings'].join(' ')).toMatch(/also in homebrew.items.*a second one was added/s);
    const actor = stored(w, 'Brunhilde Eisenfaust');
    expect(item(actor, 'Soldier')?.['system'].current.value).toBe(false);
    expect(item(actor, 'Entertain (Taunt)')?.['_stats']).toEqual({
      compendiumSource: expect.stringContaining('cEntertain'),
    });
    expect(w.foundry.notifications.some(note => note.message.includes('added blank: Lute'))).toBe(
      true
    );
  });

  it('is an error with every list when nothing can be added', async () => {
    const w = open('wfrp4e');
    const result = await w.harness.call('wfrp4e-add-items', {
      actor: 'Brunhilde Eisenfaust',
      items: [{ name: 'Twin Blade' }, { name: 'Dodge', pack: 'nowhere' }],
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(
      /No items could be added.*Twin Blade.*no item compendium id contains \\?"nowhere/s
    );
    expect(w.foundry.operations).toEqual([]);
  });
});

describe('the adapters behind the neutral tools', () => {
  it.each([
    ['wfrp4e', 'Brunhilde Eisenfaust', { career: 'Soldier', species: 'Dwarf' }],
    ['cosmere', 'Veyla', { level: 3, investiture: { value: 2, max: 3 } }],
    ['traveller', 'Kessa Vorn', { actorType: 'traveller', profession: 'Scout' }],
  ] as const)(
    'get-character reads %s values through the adapter',
    async (kind, name, basicInfo) => {
      const w = open(kind);
      const answer = json(await w.harness.call('get-character', { identifier: name }));
      expect(answer['basicInfo']).toMatchObject(basicInfo);
      expect(JSON.stringify(answer)).not.toContain('Circular Reference');
    }
  );

  it('lists Cosmere adversaries by tier from the creature index', async () => {
    const w = open('cosmere');
    const result = await w.harness.call('list-creatures-by-criteria', { tier: 3 });
    const all = text(result);
    expect(result.isError, all).toBeFalsy();
    expect(all).toContain('Chasmfiend');
    expect(all).not.toContain('Veyla');
  });
});
