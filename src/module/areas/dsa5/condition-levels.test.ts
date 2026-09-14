/**
 * Toggle-token-condition with a level in a dsa5 world, from the tool
 * through the adapter's calls to the condition effect and back.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { openDsa5World, type Dsa5World } from './testing.js';

let world: Dsa5World | null = null;
afterEach(() => {
  world?.close();
  world = null;
});

type Json = Record<string, any>;
const json = (result: { content: Array<{ text?: string }> }): Json =>
  JSON.parse(result.content[0]?.text ?? '{}') as Json;
const painOf = (w: Dsa5World) =>
  (
    (
      w.foundry
        .collection('Actor')
        .contents.find(actor => actor['name'] === 'Alrik')
        ?.toObject() as Json
    )['effects'] as Json[]
  ).find(effect => effect['statuses']?.includes('inpain'));

describe('condition levels in dsa5', () => {
  it('raises pain from level 2 to 3 on the effect Alrik already has, and reads it back', async () => {
    const w = (world = openDsa5World());
    const answer = json(
      await w.harness.call('toggle-token-condition', {
        tokenId: 'tok1',
        conditionId: 'inpain',
        level: 3,
      })
    );
    expect(answer).toMatchObject({ changed: true, level: 3, previousLevel: 2, isActive: true });
    expect(painOf(w)?.['system']).toMatchObject({ condition: { value: 3, manual: 3, auto: 0 } });
  });

  it('refuses a level above the highest of the condition and changes nothing', async () => {
    const w = (world = openDsa5World());
    const result = await w.harness.call('toggle-token-condition', {
      tokenId: 'tok1',
      conditionId: 'inpain',
      level: 5,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('goes up to level 4');
    expect(painOf(w)?.['system']).toMatchObject({ condition: { value: 2 } });
  });

  it('removes the condition with level 0 and creates it again at a chosen level', async () => {
    const w = (world = openDsa5World());
    json(
      await w.harness.call('toggle-token-condition', {
        tokenId: 'tok1',
        conditionId: 'inpain',
        level: 0,
      })
    );
    expect(painOf(w)).toBeUndefined();
    const again = json(
      await w.harness.call('toggle-token-condition', {
        tokenId: 'tok1',
        conditionId: 'inpain',
        level: 2,
      })
    );
    expect(again).toMatchObject({ changed: true, level: 2, previousLevel: null });
    expect(painOf(w)?.['system']).toMatchObject({ condition: { value: 2, manual: 2, max: 4 } });
  });
});
