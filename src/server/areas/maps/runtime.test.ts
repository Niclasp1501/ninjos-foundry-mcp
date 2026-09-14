/**
 * A module that does not know the map queries: of this generation with the
 * code UNKNOWN_QUERY, of the previous generation only with its message. Both
 * stop at once with the sentence of the core, and nothing is retried.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BridgeError } from '../../bridge/foundry-bridge.js';
import { silentLogger } from '../../logger.js';
import { isRetryable } from './errors.js';
import { createMapsRuntime, type MapsRuntime } from './runtime.js';

let runtime: MapsRuntime | null = null;
afterEach(async () => {
  await runtime?.close();
  runtime = null;
});

function open(failure: BridgeError): MapsRuntime {
  runtime = createMapsRuntime({}, { logger: silentLogger });
  runtime.useBridge(async () => {
    throw failure;
  });
  return runtime;
}

describe('MapsRuntime with a module too old for maps', () => {
  it('recognises a module of the previous generation by its message alone', async () => {
    const subject = open(
      new BridgeError(
        'MODULE_ERROR',
        'No handler found for query: ninjos-foundry-mcp.getMapSettings'
      )
    );
    const error = await subject.mapSettings().then(
      () => null,
      (problem: unknown) => problem
    );
    expect(error).toMatchObject({
      code: 'MODULE_TOO_OLD',
      message: expect.stringContaining('does not know the query "getMapSettings"'),
    });
    expect(isRetryable(error)).toBe(false);
  });

  it('recognises a module of this generation by its code', async () => {
    const subject = open(new BridgeError('MODULE_ERROR', 'Unknown query', 'UNKNOWN_QUERY'));
    await expect(subject.mapSettings()).rejects.toMatchObject({
      code: 'MODULE_TOO_OLD',
      message: expect.stringContaining('older than this server'),
    });
  });

  it('passes every other failure on unchanged', async () => {
    const lost = new BridgeError('CONNECTION_LOST', 'The connection to Foundry was lost');
    const subject = open(lost);
    await expect(subject.mapSettings()).rejects.toBe(lost);
  });
});
