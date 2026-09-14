/**
 * The maps area, for tests only: a ComfyUI that answers like the real one,
 * on a free port, and a spawn that starts it instead of Python.
 *
 * Never a real ComfyUI, never a model download, never one of the ports
 * 31411 or 31414 to 31416.
 */
import { EventEmitter } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ChildLike, SpawnFn } from './service.js';

export const FORBIDDEN_TEST_PORTS: ReadonlySet<number> = new Set([31411, 31414, 31415, 31416]);

function assertAllowed(port: number): void {
  if (FORBIDDEN_TEST_PORTS.has(port)) throw new Error(`Tests must never use port ${port}`);
}

/** A port the system reports as free right now. */
export async function freePort(): Promise<number> {
  for (;;) {
    const server = createServer();
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (!FORBIDDEN_TEST_PORTS.has(port)) return port;
  }
}

/** Bytes that start like a PNG, of the given length. */
export function fakePng(length = 700_000): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (let i = 8; i < length; i += 1) bytes[i] = (i * 31) % 251;
  return bytes;
}

export interface FakeComfyOptions {
  checkpoints?: string[];
  vaes?: string[];
  /** Progress messages per prompt. Default 35. */
  steps?: number;
  stepMs?: number;
  image?: Uint8Array;
  /** The first n prompts end with an execution error. */
  failFirst?: number;
  /** Answer /system_stats with HTTP 500, like a program that is not ComfyUI. */
  foreign?: boolean;
}

interface Execution {
  id: string;
  clientId: string;
  timer: NodeJS.Timeout | null;
}

export class FakeComfyUI {
  readonly prompts: Array<{ id: string; clientId: string; graph: Record<string, unknown> }> = [];
  readonly interrupts: string[] = [];
  readonly removed: string[] = [];
  readonly sockets = new Set<WebSocket>();
  progressSent = 0;
  port = 0;
  #server: Server;
  #wss: WebSocketServer;
  #history = new Map<string, unknown>();
  #pending: Execution[] = [];
  #running: Execution | null = null;
  #failLeft: number;
  #counter = 0;
  #clients = new Map<WebSocket, string>();

  private constructor(readonly options: FakeComfyOptions) {
    this.#failLeft = options.failFirst ?? 0;
    this.#server = createServer((request, response) => void this.#handle(request, response));
    this.#wss = new WebSocketServer({ server: this.#server, path: '/ws' });
    this.#wss.on('connection', (socket, request) => {
      const clientId = new URL(request.url ?? '/', 'http://x').searchParams.get('clientId') ?? '';
      this.sockets.add(socket);
      this.#clients.set(socket, clientId);
      socket.on('close', () => {
        this.sockets.delete(socket);
        this.#clients.delete(socket);
      });
    });
  }

  static async start(options: FakeComfyOptions = {}, port = 0): Promise<FakeComfyUI> {
    assertAllowed(port);
    const fake = new FakeComfyUI(options);
    await new Promise<void>((resolve, reject) => {
      fake.#server.once('error', reject);
      fake.#server.listen(port, '127.0.0.1', () => resolve());
    });
    const address = fake.#server.address();
    fake.port = typeof address === 'object' && address ? address.port : port;
    assertAllowed(fake.port);
    return fake;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  get runningPrompt(): string | null {
    return this.#running?.id ?? null;
  }

  async close(): Promise<void> {
    for (const execution of [this.#running, ...this.#pending])
      if (execution?.timer) clearTimeout(execution.timer);
    for (const socket of this.sockets) socket.terminate();
    this.#wss.close();
    this.#server.closeAllConnections();
    await new Promise<void>(resolve => this.#server.close(() => resolve()));
  }

  async #body(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    return text ? JSON.parse(text) : {};
  }

  #json(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://x');
    const path = url.pathname;
    if (path === '/system_stats') {
      if (this.options.foreign) return this.#json(response, 500, { error: 'not comfy' });
      return this.#json(response, 200, { system: { os: 'fake' }, devices: [] });
    }
    if (path === '/object_info/CheckpointLoaderSimple') {
      return this.#json(response, 200, {
        CheckpointLoaderSimple: {
          input: {
            required: {
              ckpt_name: [
                this.options.checkpoints ?? [
                  'sd_xl_base_1.0.safetensors',
                  'dnd_battlemaps_sdxl.safetensors',
                ],
              ],
            },
          },
        },
      });
    }
    if (path === '/object_info/VAELoader') {
      // The newer combo form, so both forms are read.
      return this.#json(response, 200, {
        VAELoader: {
          input: {
            required: {
              vae_name: ['COMBO', { options: this.options.vaes ?? ['sdxl_vae.safetensors'] }],
            },
          },
        },
      });
    }
    if (path === '/prompt' && request.method === 'POST') {
      const body = (await this.#body(request)) as {
        prompt?: Record<string, unknown>;
        client_id?: string;
      };
      this.#counter += 1;
      const id = `prompt-${this.#counter}`;
      const clientId = body.client_id ?? '';
      this.prompts.push({ id, clientId, graph: body.prompt ?? {} });
      this.#pending.push({ id, clientId, timer: null });
      this.#next();
      return this.#json(response, 200, { prompt_id: id, number: this.#counter, node_errors: {} });
    }
    if (path.startsWith('/history/')) {
      const id = decodeURIComponent(path.slice('/history/'.length));
      const entry = this.#history.get(id);
      return this.#json(response, 200, entry ? { [id]: entry } : {});
    }
    if (path === '/queue' && request.method === 'GET') {
      return this.#json(response, 200, {
        queue_running: this.#running ? [[0, this.#running.id, {}, {}, []]] : [],
        queue_pending: this.#pending.map((execution, index) => [
          index + 1,
          execution.id,
          {},
          {},
          [],
        ]),
      });
    }
    if (path === '/queue' && request.method === 'POST') {
      const body = (await this.#body(request)) as { delete?: string[] };
      for (const id of body.delete ?? []) {
        this.removed.push(id);
        this.#pending = this.#pending.filter(execution => execution.id !== id);
      }
      return this.#json(response, 200, {});
    }
    if (path === '/interrupt' && request.method === 'POST') {
      const body = (await this.#body(request)) as { prompt_id?: string };
      const running = this.#running;
      if (running && (!body.prompt_id || body.prompt_id === running.id)) {
        this.interrupts.push(running.id);
        if (running.timer) clearTimeout(running.timer);
        this.#history.set(running.id, {
          status: {
            status_str: 'error',
            completed: false,
            messages: [['execution_interrupted', {}]],
          },
          outputs: {},
        });
        this.#running = null;
        this.#next();
      }
      return this.#json(response, 200, {});
    }
    if (path === '/view') {
      response.writeHead(200, { 'Content-Type': 'image/png' });
      response.end(Buffer.from(this.options.image ?? fakePng()));
      return;
    }
    this.#json(response, 404, { error: `unknown path ${path}` });
  }

  #next(): void {
    if (this.#running) return;
    const execution = this.#pending.shift();
    if (!execution) return;
    this.#running = execution;
    const steps = this.options.steps ?? 35;
    let step = 0;
    const tick = () => {
      step += 1;
      for (const [socket, clientId] of this.#clients) {
        if (clientId !== execution.clientId) continue;
        socket.send(
          JSON.stringify({
            type: 'progress',
            data: { value: step, max: steps, prompt_id: execution.id },
          })
        );
        this.progressSent += 1;
      }
      if (step < steps) {
        execution.timer = setTimeout(tick, this.options.stepMs ?? 2);
        return;
      }
      if (this.#failLeft > 0) {
        this.#failLeft -= 1;
        this.#history.set(execution.id, {
          status: {
            status_str: 'error',
            completed: false,
            messages: [
              [
                'execution_error',
                { node_type: 'KSampler', exception_message: 'CUDA out of memory' },
              ],
            ],
          },
          outputs: {},
        });
      } else {
        this.#history.set(execution.id, {
          status: { status_str: 'success', completed: true, messages: [] },
          outputs: {
            '8': { images: [{ filename: `map_${execution.id}.png`, subfolder: '', type: 'temp' }] },
          },
        });
      }
      this.#running = null;
      this.#next();
    };
    execution.timer = setTimeout(tick, this.options.stepMs ?? 2);
  }
}

class FakeChild extends EventEmitter implements ChildLike {
  pid = 4242;
  exitCode: number | null = null;
  signalCode: string | null = null;
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  onKill: (() => Promise<void>) | null = null;

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    if (this.exitCode !== null || this.signalCode) return false;
    void (async () => {
      await this.onKill?.();
      this.signalCode = signal;
      this.emit('exit', null, signal);
    })();
    return true;
  }
}

export interface FakeSpawn {
  spawn: SpawnFn;
  calls: Array<{ command: string; args: string[]; cwd: string }>;
  running: FakeComfyUI[];
}

/**
 * A spawn that starts a FakeComfyUI on the port in the arguments.
 * `mode: 'exit'` ends at once with code 1 and an error line, like a broken Python.
 * `mode: 'silent'` never answers.
 */
export function fakeSpawn(
  options: { mode?: 'start' | 'exit' | 'silent'; delayMs?: number; comfy?: FakeComfyOptions } = {}
): FakeSpawn {
  const result: FakeSpawn = { calls: [], running: [], spawn: () => new FakeChild() };
  result.spawn = (command, args, spawnOptions) => {
    result.calls.push({ command, args, cwd: spawnOptions.cwd });
    const child = new FakeChild();
    const port = Number(args[args.indexOf('--port') + 1]);
    const mode = options.mode ?? 'start';
    setTimeout(() => {
      if (mode === 'exit') {
        child.stderr.emit('data', 'ModuleNotFoundError: No module named torch\n');
        child.exitCode = 1;
        child.emit('exit', 1, null);
        return;
      }
      if (mode === 'silent') return;
      void FakeComfyUI.start(options.comfy ?? {}, port).then(fake => {
        result.running.push(fake);
        child.onKill = async () => {
          await fake.close();
          result.running.splice(result.running.indexOf(fake), 1);
        };
      });
    }, options.delayMs ?? 5);
    return child;
  };
  return result;
}
