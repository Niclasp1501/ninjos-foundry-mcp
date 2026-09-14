import { describe, expect, it } from 'vitest';
import { SystemAdapterRegistry, type SystemAdapter } from '../common/game-systems.js';
import { SystemDetector } from '../common/system-detection.js';
import { activeGameSystem, requireSystemQuestions, systemAnswer } from './game-systems.js';
import { installServerAreas } from './tools/areas.js';
import { PromptRegistry, ResourceRegistry } from './tools/resources.js';

const sample: SystemAdapter = {
  id: 'sample',
  title: 'Sample System',
  compendiums: { defaults: { Item: ['sample.powers'] } },
};

const worldInfo = (system: string) => ({
  query: async (name: string) => {
    if (name !== 'getWorldInfo') throw new Error(`unexpected query ${name}`);
    return { id: 'w', system, systemVersion: '1.0', foundryVersion: '14.350' };
  },
});

describe('game systems on the server', () => {
  it('detects the system through getWorldInfo and finds the adapter the areas installed', async () => {
    const registry = new SystemAdapterRegistry();
    installServerAreas([{ id: 'sample-area', adapters: [sample] }], {
      tools: { register: () => undefined },
      resources: new ResourceRegistry(),
      prompts: new PromptRegistry(),
      adapters: registry,
    });
    const sources = { registry, detector: new SystemDetector() };
    const system = await activeGameSystem(worldInfo('sample'), sources);
    expect(system).toMatchObject({ id: 'sample', title: 'Sample System', version: '1.0' });
    expect(system.detection).toMatchObject({ source: 'module', foundryVersion: '14.350' });
    const answer = await systemAnswer(worldInfo('sample'), 'compendiums', sources);
    expect(answer.questions.defaults).toEqual({ Item: ['sample.powers'] });
  });

  it('says why the system is unknown when the module cannot answer', async () => {
    const sources = { registry: new SystemAdapterRegistry(), detector: new SystemDetector() };
    const offline = {
      query: async () => {
        throw new Error('Foundry VTT module not connected');
      },
    };
    await expect(
      requireSystemQuestions(offline, 'creatures', 'The creature index', sources)
    ).rejects.toThrow(
      'The creature index needs to know the game system, and it could not be detected: the world info could not be read: Foundry VTT module not connected'
    );
    await expect(
      requireSystemQuestions(worldInfo('homebrew'), 'creatures', 'The creature index', sources)
    ).rejects.toThrow(/not supported for the game system "homebrew"/);
  });
});
