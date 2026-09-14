/**
 * What the map runtime does around the connection of a module.
 * Failure notices wait for a module, and mapGenAutoStart of the world starts
 * ComfyUI when a module introduces itself. Nothing real is started: the
 * installation is not found, and ComfyUI is looked for on a free port.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BridgeError } from '../../bridge/foundry-bridge.js';
import type { Logger } from '../../logger.js';
import { createMapsRuntime, type MapsRuntime } from './runtime.js';
import { fakeSpawn, freePort } from './testing.js';

let runtime: MapsRuntime | null = null;
afterEach(async () => {
  await runtime?.close();
  runtime = null;
});

function capture(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const write = (message: string) => void lines.push(message);
  return { lines, logger: { debug: write, info: write, warn: write, error: write } };
}

async function open(answers: { settings?: unknown; failWith?: BridgeError } = {}): Promise<{
  subject: MapsRuntime;
  sent: Array<{ name: string; data: unknown }>;
  lines: string[];
}> {
  const { logger, lines } = capture();
  const port = await freePort();
  const subject = createMapsRuntime(
    { COMFYUI_PORT: String(port) },
    {
      logger,
      spawn: fakeSpawn().spawn,
      locate: () => ({ found: false, searched: [], problem: 'no installation in tests' }),
    }
  );
  runtime = subject;
  const sent: Array<{ name: string; data: unknown }> = [];
  subject.useBridge(async (name, data) => {
    if (answers.failWith) throw answers.failWith;
    sent.push({ name, data });
    if (name === 'getMapSettings') return answers.settings ?? { quality: 'low', notes: [] };
    return { shown: 'ok' };
  });
  return { subject, sent, lines };
}

const notice = { jobId: 'map-1', name: 'Swamp', reason: 'CUDA out of memory' };

const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i += 1) await new Promise(r => setTimeout(r, 5));
};

describe('failure notices without a module', () => {
  it('keeps a notice while no module is connected and delivers it when one introduces itself', async () => {
    const { subject, sent } = await open();
    let connected = false;
    subject.useConnection(() => connected);
    await subject.tellFailure(notice);
    expect(sent).toEqual([]);
    expect(subject.undeliveredFailures).toEqual([notice]);

    connected = true;
    await subject.moduleIntroduced();
    expect(sent[0]).toEqual({ name: 'mapJobFailed', data: notice });
    expect(subject.undeliveredFailures).toEqual([]);
  });

  it('keeps a notice when the connection is gone while sending, and passes other failures on', async () => {
    const lost = await open({ failWith: new BridgeError('NOT_CONNECTED', 'No module') });
    await lost.subject.tellFailure(notice);
    expect(lost.subject.undeliveredFailures).toEqual([notice]);
    await lost.subject.close();

    const refused = await open({
      failWith: new BridgeError('MODULE_ERROR', 'refused', 'PERMISSION_DENIED'),
    });
    await expect(refused.subject.tellFailure(notice)).rejects.toThrow('refused');
    expect(refused.subject.undeliveredFailures).toEqual([]);
  });
});

describe('mapGenAutoStart', () => {
  it('starts ComfyUI when the world asks for it as a module introduces itself', async () => {
    const { subject, lines } = await open({
      settings: { quality: 'low', notes: [], autoStart: true },
    });
    await subject.moduleIntroduced();
    await waitFor(() => lines.some(line => line.startsWith('ComfyUI autostart (mapGenAutoStart)')));
    expect(lines).toContainEqual(
      expect.stringContaining(
        'ComfyUI autostart (mapGenAutoStart) failed: no installation in tests'
      )
    );
  });

  it('starts nothing when the setting is off or a module does not report it', async () => {
    const { subject, lines } = await open({ settings: { quality: 'low', notes: [] } });
    await subject.moduleIntroduced();
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(lines.some(line => line.includes('autostart'))).toBe(false);
  });
});
