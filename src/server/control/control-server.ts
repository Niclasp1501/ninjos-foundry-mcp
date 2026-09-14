/**
 * The control channel of the backend: TCP on 127.0.0.1:31414, one JSON
 * message per line.
 *
 * Methods of the previous generation: `ping`, `list_tools`, `call_tool`.
 * Added here: `list_resources`, `read_resource`, `list_prompts`, `get_prompt`,
 * `cancel` and `status`; since the mcp-extras area `list_resource_templates`,
 * `complete` and `watch`, after which the client also gets `{ event }` lines
 * without id. A wrapper of the previous generation never calls
 * them, and never receives a progress line, because progress is only sent
 * when a request asks for it with `params.progress: true`.
 */
import { createServer, type Server, type Socket } from 'node:net';
import { looksLikeHttpRequest } from '../bridge/connection-guards.js';
import type { Logger } from '../logger.js';
import type { BackendApi, CompletionRequest, CompletionValues } from './api.js';
import { encodeLine, LineSplitter, type ControlLine } from './line-codec.js';

export interface ControlServerOptions {
  host: string;
  port: number;
  api: BackendApi;
  logger: Logger;
  /** Extra information for the `status` method. */
  status?: () => Record<string, unknown>;
  onClientsChanged?: (count: number) => void;
}

/** Enough bytes to tell a request line from a JSON message. */
const SNIFF_BYTES = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(value)) return out;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') out[key] = item;
  }
  return out;
}

export class ControlServer {
  private server: Server | null = null;
  private readonly clients = new Set<Socket>();
  /**
   * Every open connection, also one that has not sent a byte yet. `clients`
   * only counts decided connections; closing only those left a silent TCP
   * connection holding `server.close` and the backend shutdown forever.
   */
  private readonly connections = new Set<Socket>();

  constructor(private readonly options: ControlServerOptions) {}

  get clientCount(): number {
    return this.clients.size;
  }

  /** Resolves with the bound port. Rejects when the port is taken. */
  listen(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer(socket => this.accept(socket));
      server.once('error', reject);
      server.listen(this.options.port, this.options.host, () => {
        server.off('error', reject);
        server.on('error', error => this.options.logger.error('Control server error', error));
        this.server = server;
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : this.options.port);
      });
    });
  }

  close(): Promise<void> {
    for (const socket of this.connections) socket.destroy();
    this.connections.clear();
    this.clients.clear();
    return new Promise(resolve => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      this.server = null;
    });
  }

  private accept(socket: Socket): void {
    socket.setEncoding('utf8');
    socket.setNoDelay(true);
    this.connections.add(socket);

    const splitter = new LineSplitter();
    const inFlight = new Map<string, AbortController>();
    const session: Session = { unwatch: null };
    let decided = false;
    let counted = false;

    const send = (line: ControlLine) => {
      if (!socket.destroyed) socket.write(encodeLine(line));
    };

    socket.on('data', (chunk: string) => {
      let lines: string[];
      try {
        lines = splitter.push(chunk);
      } catch (error) {
        this.options.logger.warn('Dropping a control connection', error);
        socket.destroy();
        return;
      }

      if (!decided) {
        const start = lines.length ? `${lines[0]}\n` : splitter.pending;
        if (!lines.length && start.length < SNIFF_BYTES) {
          // Not enough to judge yet; keep the lines buffered until we are.
          return;
        }
        decided = true;
        if (looksLikeHttpRequest(start)) {
          // A browser can POST to this port. Its body line would otherwise run as a tool call.
          this.options.logger.warn('Refused an HTTP request on the control port', {
            remote: socket.remoteAddress,
          });
          socket.destroy();
          return;
        }
        this.clients.add(socket);
        counted = true;
        this.options.onClientsChanged?.(this.clients.size);
      }

      for (const line of lines) void this.handleLine(line, send, inFlight, session);
    });

    const cleanup = () => {
      this.connections.delete(socket);
      session.unwatch?.();
      session.unwatch = null;
      for (const controller of inFlight.values()) controller.abort();
      inFlight.clear();
      if (counted && this.clients.delete(socket))
        this.options.onClientsChanged?.(this.clients.size);
      counted = false;
    };
    socket.on('close', cleanup);
    socket.on('error', () => socket.destroy());
  }

  private async handleLine(
    line: string,
    send: (line: ControlLine) => void,
    inFlight: Map<string, AbortController>,
    session: Session
  ): Promise<void> {
    let request: unknown;
    try {
      request = JSON.parse(line);
    } catch (error) {
      send({ error: { message: `Invalid JSON: ${(error as Error).message}` } });
      return;
    }
    if (!isRecord(request) || typeof request['method'] !== 'string') {
      send({ error: { message: 'A control request needs a method' } });
      return;
    }

    const rawId = request['id'];
    const id: string | number = typeof rawId === 'number' || typeof rawId === 'string' ? rawId : '';
    const params = isRecord(request['params']) ? request['params'] : {};
    const key = String(id);
    const controller = new AbortController();
    if (key) inFlight.set(key, controller);

    try {
      const result = await this.dispatch(
        request['method'],
        params,
        id,
        send,
        controller.signal,
        inFlight,
        session
      );
      send({ id, result });
    } catch (error) {
      send({ id, error: { message: error instanceof Error ? error.message : String(error) } });
    } finally {
      if (key && inFlight.get(key) === controller) inFlight.delete(key);
    }
  }

  private async dispatch(
    method: string,
    params: Record<string, unknown>,
    id: string | number,
    send: (line: ControlLine) => void,
    signal: AbortSignal,
    inFlight: Map<string, AbortController>,
    session: Session
  ): Promise<unknown> {
    const { api } = this.options;
    const wantsProgress = params['progress'] === true;
    const onProgress = wantsProgress
      ? (progress: { progress: number; total?: number; message?: string }) => send({ id, progress })
      : undefined;
    const callOptions = onProgress ? { onProgress, signal } : { signal };

    switch (method) {
      case 'ping':
        return { ok: true };
      case 'list_tools':
        return { tools: await api.listTools() };
      case 'call_tool': {
        const name = typeof params['name'] === 'string' ? params['name'] : '';
        const args = isRecord(params['args']) ? params['args'] : {};
        return await api.callTool(name, args, callOptions);
      }
      case 'list_resources':
        return { resources: await api.listResources() };
      case 'read_resource':
        return await api.readResource(
          typeof params['uri'] === 'string' ? params['uri'] : '',
          callOptions
        );
      case 'list_prompts':
        return { prompts: await api.listPrompts() };
      case 'get_prompt':
        return await api.getPrompt(
          typeof params['name'] === 'string' ? params['name'] : '',
          stringRecord(params['args'])
        );
      case 'list_resource_templates':
        return { resourceTemplates: (await api.listResourceTemplates?.()) ?? [] };
      case 'complete':
        return await this.complete(params);
      case 'watch': {
        // Event lines have no id and go only to a client that asked here.
        if (!api.watch) throw new Error('Unknown method');
        if (!session.unwatch) session.unwatch = api.watch(event => send({ event }));
        return { watching: true };
      }
      case 'cancel': {
        const target = params['id'];
        const controller = target === undefined ? undefined : inFlight.get(String(target));
        controller?.abort();
        return { cancelled: Boolean(controller) };
      }
      case 'status':
        return { clients: this.clients.size, ...(this.options.status?.() ?? {}) };
      default:
        throw new Error('Unknown method');
    }
  }

  private async complete(params: Record<string, unknown>): Promise<CompletionValues> {
    const { api } = this.options;
    const ref = isRecord(params['ref']) ? params['ref'] : {};
    const argument = isRecord(params['argument']) ? params['argument'] : {};
    const name = typeof argument['name'] === 'string' ? argument['name'] : '';
    const value = typeof argument['value'] === 'string' ? argument['value'] : '';
    let target: CompletionRequest['ref'];
    if (ref['type'] === 'ref/prompt' && typeof ref['name'] === 'string') {
      target = { type: 'ref/prompt', name: ref['name'] };
    } else if (ref['type'] === 'ref/resource' && typeof ref['uri'] === 'string') {
      target = { type: 'ref/resource', uri: ref['uri'] };
    } else {
      throw new Error(
        'A completion needs a ref of type ref/prompt with name or ref/resource with uri'
      );
    }
    if (!api.complete) return { values: [] };
    return api.complete({
      ref: target,
      argument: { name, value },
      arguments: stringRecord(params['arguments']),
    });
  }
}

/** Per connection. */
interface Session {
  unwatch: (() => void) | null;
}
