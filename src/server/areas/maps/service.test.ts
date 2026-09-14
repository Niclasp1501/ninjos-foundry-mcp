/**
 * The ComfyUI process: one start at a time, loopback only, tracked, and a stop
 * that only claims what it did. Against a fake ComfyUI on free ports and a
 * spawn that never starts Python.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../../logger.js';
import type { LocateResult } from './locate.js';
import { ComfyService, type SpawnFn } from './service.js';
import { FakeComfyUI, fakeSpawn, freePort } from './testing.js';

const found: LocateResult = {
  found: true,
  searched: [],
  installation: {
    root: '/opt/ComfyUI',
    workDir: '/opt/ComfyUI',
    mainPy: '/opt/ComfyUI/main.py',
    python: '/opt/ComfyUI/venv/bin/python',
    pythonArgs: [],
    portable: false,
  },
};

const cleanup: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

function service(
  port: number,
  spawn: SpawnFn,
  options: { locate?: LocateResult; readyTimeoutMs?: number } = {}
) {
  const created = new ComfyService({
    host: '127.0.0.1',
    port,
    locate: () => options.locate ?? found,
    spawn,
    logger: silentLogger,
    readyPollMs: 10,
    readyTimeoutMs: options.readyTimeoutMs ?? 3000,
    stopGraceMs: 200,
    probeTimeoutMs: 1000,
  });
  cleanup.push(() => created.dispose());
  return created;
}

describe('ComfyService', () => {
  it('reports stopped when nothing answers', async () => {
    const port = await freePort();
    await expect(service(port, fakeSpawn().spawn).status()).resolves.toMatchObject({
      state: 'stopped',
    });
  });

  it('uses a ComfyUI started elsewhere, starts no second one, and does not claim to stop it', async () => {
    const comfy = await FakeComfyUI.start();
    cleanup.push(() => comfy.close());
    const spawner = fakeSpawn();
    const subject = service(comfy.port, spawner.spawn);

    await expect(subject.start()).resolves.toMatchObject({
      state: 'running',
      alreadyRunning: true,
    });
    expect(spawner.calls).toHaveLength(0);
    await expect(subject.stop()).rejects.toThrow(
      'was not started by this server, so it is not stopped from here'
    );
    await expect(subject.status()).resolves.toMatchObject({
      state: 'running',
      detail: 'running, not started by this server',
    });
  });

  it('starts one process for parallel requests, on loopback, and stops exactly that one', async () => {
    const port = await freePort();
    const spawner = fakeSpawn();
    cleanup.push(() => Promise.all(spawner.running.map(fake => fake.close())));
    const subject = service(port, spawner.spawn);

    const [first, second] = await Promise.all([subject.start(), subject.start()]);
    expect(spawner.calls).toHaveLength(1);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      state: 'running',
      detail: expect.stringContaining('started by this server'),
    });
    expect(spawner.calls[0]).toEqual({
      command: '/opt/ComfyUI/venv/bin/python',
      args: [
        '/opt/ComfyUI/main.py',
        '--listen',
        '127.0.0.1',
        '--port',
        String(port),
        '--disable-auto-launch',
      ],
      cwd: '/opt/ComfyUI',
    });
    expect(subject.ownsProcess).toBe(true);

    await expect(subject.start()).resolves.toMatchObject({ alreadyRunning: true });
    expect(spawner.calls).toHaveLength(1);

    await expect(subject.stop()).resolves.toEqual({ state: 'stopped', detail: 'ComfyUI stopped' });
    expect(spawner.running).toHaveLength(0);
    expect(subject.ownsProcess).toBe(false);
    await expect(subject.stop()).resolves.toEqual({
      state: 'stopped',
      detail: 'ComfyUI is already stopped',
    });
  });

  it('reports a process that ends before it answers, with its last output', async () => {
    const port = await freePort();
    const subject = service(port, fakeSpawn({ mode: 'exit' }).spawn);
    await expect(subject.start()).rejects.toThrow(
      /ComfyUI process exited before becoming ready \(exit code 1\)\. Last output: ModuleNotFoundError: No module named torch/
    );
    expect(subject.ownsProcess).toBe(false);
  });

  it('stops a process that never becomes ready within the limit', async () => {
    const port = await freePort();
    const subject = service(port, fakeSpawn({ mode: 'silent' }).spawn, { readyTimeoutMs: 120 });
    await expect(subject.start()).rejects.toThrow(
      'did not become ready within 0 seconds; the process was stopped'
    );
    expect(subject.ownsProcess).toBe(false);
  });

  it('starts nothing without an installation and names the places', async () => {
    const port = await freePort();
    const spawner = fakeSpawn();
    const subject = service(port, spawner.spawn, {
      locate: {
        found: false,
        searched: ['/x/main.py'],
        problem: 'ComfyUI installation not found: searched /x/main.py',
      },
    });
    await expect(subject.start()).rejects.toThrow(
      'ComfyUI installation not found: searched /x/main.py'
    );
    expect(spawner.calls).toHaveLength(0);
  });

  it('refuses a port that answers but is not ComfyUI', async () => {
    const foreign = await FakeComfyUI.start({ foreign: true });
    cleanup.push(() => foreign.close());
    const spawner = fakeSpawn();
    const subject = service(foreign.port, spawner.spawn);
    await expect(subject.start()).rejects.toThrow('answers, but not as ComfyUI');
    await expect(subject.status()).resolves.toMatchObject({ state: 'error' });
    expect(spawner.calls).toHaveLength(0);
  });
});
