import { describe, expect, it } from 'vitest';
import { isPreparedData } from '../common/game-systems.js';
import { adapterData, overlayPrepared, preparedSnapshot } from './prepared-data.js';

describe('preparedSnapshot', () => {
  it('copies prepared values as plain data, without back references, documents or cycles', () => {
    const actorDocument = { documentName: 'Actor', toObject: () => ({}) };
    const system: Record<string, unknown> = {
      attributes: { ac: { value: 19 }, hp: { value: 12, max: 12 } },
      traits: { dr: { value: new Set(['fire', 'cold']) } },
      linked: actorDocument,
      lookup: new Map([['a', 1]]),
      broken: Number.NaN,
      method: () => 1,
    };
    Object.defineProperty(system, 'parent', { value: actorDocument, enumerable: true });
    system['self'] = system;
    Object.defineProperty(system, 'throws', {
      enumerable: true,
      get: () => {
        throw new Error('not ready');
      },
    });
    expect(preparedSnapshot(system)).toEqual({
      attributes: { ac: { value: 19 }, hp: { value: 12, max: 12 } },
      traits: { dr: { value: ['fire', 'cold'] } },
      broken: null,
    });
  });
});

describe('overlayPrepared', () => {
  it('lets prepared values win and keeps stored values the prepared data lacks', () => {
    expect(
      overlayPrepared(
        { ac: { calc: 'default', flat: null }, hp: { value: 12, max: null }, bio: 'text' },
        { ac: { value: 19, flat: null }, hp: { max: 12 } }
      )
    ).toEqual({
      ac: { calc: 'default', flat: null, value: 19 },
      hp: { value: 12, max: 12 },
      bio: 'text',
    });
  });
});

describe('adapterData', () => {
  it('puts the prepared system of the actor and of each item over the stored data and marks it', () => {
    const itemLive = { system: { level: 3, prepared: true } };
    const actor = {
      system: { attributes: { ac: { value: 19 } } },
      items: { get: (id: string) => (id === 'i1' ? itemLive : undefined) },
      toObject: () => ({
        name: 'Test Fighter',
        system: { attributes: { ac: { calc: 'default' } } },
        items: [
          { _id: 'i1', name: 'Sword', system: { level: 0 } },
          { _id: 'gone', name: 'Rope', system: {} },
        ],
      }),
    };
    const data = adapterData(actor);
    expect(isPreparedData(data)).toBe(true);
    expect(data['system']).toEqual({ attributes: { ac: { calc: 'default', value: 19 } } });
    expect(data['items']).toEqual([
      { _id: 'i1', name: 'Sword', system: { level: 3, prepared: true }, preparedData: true },
      { _id: 'gone', name: 'Rope', system: {} },
    ]);
  });

  it('leaves data unmarked when the live system derives nothing beyond the stored one', () => {
    const stored = { status: { wounds: { value: 25, max: 0, initial: 5 } } };
    const data = adapterData({
      system: { status: { wounds: { initial: 5, max: 0, value: 25 } } },
      toObject: () => ({ name: 'Alrik', system: structuredClone(stored) }),
    });
    expect(isPreparedData(data)).toBe(false);
    expect(data['system']).toEqual(stored);
  });

  it('leaves a document without a live system as stored and unmarked', () => {
    const data = adapterData({ toObject: () => ({ name: 'Plain', system: { a: 1 } }) });
    expect(data).toEqual({ name: 'Plain', system: { a: 1 } });
    expect(isPreparedData(data)).toBe(false);
  });
});
