/**
 * The wrapper's side of the control channel.
 *
 * Connects at once and stays connected, so the backend counts this session
 * as long as it is open. When no backend answers, it starts one as a detached
 * process and retries with a growing pause (at most two seconds, about forty
 * attempts). It never stops the backend: other sessions depend on it.
 */
import { connect, type Socket } from 'node:net';
import type { ProgressPayload } from '../../common/protocol.js';
import type { Logger } from '../logger.js';
import type {
  BackendApi,
  BackendEvent,
  CallOptions,
  CompletionRequest,
  CompletionValues,
  ListedPrompt,
  ListedResource,
  ListedResourceTemplate,
  ListedTool,
  PromptResult,
  ResourceContents,
  ToolResult,
} from './api.js';
import { encodeLine, LineSplitter } from './line-codec.js';

export interface BackendClientOptions {
  host: string;
  port: number;
  logger: Logger;
  /** Starts a backend process. Called at most once per connection attempt series. */
  spawnBackend: () => void;
  maxAttempts?: number;
  maxDelayMs?: number;
  firstDelayMs?: number;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: ProgressPayload) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class BackendClient implements BackendApi {
  private socket: Socket | null = null;
  private connecting: Promise<Socket> | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly watchers = new Set<(event: BackendEvent) => void>();
  private nextId = 1;
  private closed = false;
  private everConnected = false;

  constructor(private readonly options: BackendClientOptions) {}

  /**
   * Hear the backend's events. The backend is asked once per
   * connection; a backend without events answers "Unknown method" and the
   * session simply gets no notifications. After a reconnect every list counts
   * as changed, because the backend may be a different one.
   */
  watch(listener: (event: BackendEvent) => void): () => void {
    const first = this.watchers.size === 0;
    this.watchers.add(listener);
    if (first && this.socket && !this.socket.destroyed) this.requestWatch();
    // Not connected yet: connect now, and adopt() asks for the events.
    else if (first) this.ensureConnected().catch(() => undefined);
    return () => this.watchers.delete(listener);
  }

  async listResourceTemplates(): Promise<ListedResourceTemplate[]> {
    const result = await this.request('list_resource_templates');
    return isRecord(result) && Array.isArray(result['resourceTemplates'])
      ? (result['resourceTemplates'] as ListedResourceTemplate[])
      : [];
  }

  async complete(request: CompletionRequest): Promise<CompletionValues> {
    const result = await this.request('complete', {
      ref: request.ref,
      argument: request.argument,
      arguments: request.arguments ?? {},
    });
    return isRecord(result) && Array.isArray(result['values'])
      ? (result as unknown as CompletionValues)
      : { values: [] };
  }

  private requestWatch(): void {
    this.request('watch').catch(error =>
      this.options.logger.info('The backend sends no notifications', {
        reason: (error as Error).message,
      })
    );
  }

  private emit(event: BackendEvent): void {
    for (const listener of [...this.watchers]) {
      try {
        listener(event);
      } catch (error) {
        this.options.logger.warn('A notification listener failed', error);
      }
    }
  }

  /** Connect now, starting a backend if needed. */
  ensureConnected(): Promise<Socket> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(this.socket);
    if (!this.connecting) {
      this.connecting = this.connectWithRetry().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  async request(
    method: string,
    params: Record<string, unknown> = {},
    options: CallOptions = {}
  ): Promise<unknown> {
    const socket = await this.ensureConnected();
    const id = `w${this.nextId++}`;
    const wantsProgress = Boolean(options.onProgress);

    return new Promise((resolve, reject) => {
      const entry: Pending = { resolve, reject };
      if (options.onProgress) entry.onProgress = options.onProgress;
      this.pending.set(id, entry);

      if (options.signal) {
        const onAbort = () => {
          if (!this.pending.has(id)) return;
          this.pending.delete(id);
          if (!socket.destroyed)
            socket.write(encodeLine({ id: `c${id}`, method: 'cancel', params: { id } }));
          reject(new Error('Cancelled by the client'));
        };
        if (options.signal.aborted) return onAbort();
        options.signal.addEventListener('abort', onAbort, { once: true });
      }

      socket.write(
        encodeLine({ id, method, params: wantsProgress ? { ...params, progress: true } : params })
      );
    });
  }

  async listTools(): Promise<ListedTool[]> {
    const result = await this.request('list_tools');
    return isRecord(result) && Array.isArray(result['tools'])
      ? (result['tools'] as ListedTool[])
      : [];
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    options: CallOptions = {}
  ): Promise<ToolResult> {
    return (await this.request('call_tool', { name, args }, options)) as ToolResult;
  }

  async listResources(): Promise<ListedResource[]> {
    const result = await this.request('list_resources');
    return isRecord(result) && Array.isArray(result['resources'])
      ? (result['resources'] as ListedResource[])
      : [];
  }

  async readResource(uri: string, options: CallOptions = {}): Promise<ResourceContents> {
    return (await this.request('read_resource', { uri }, options)) as ResourceContents;
  }

  async listPrompts(): Promise<ListedPrompt[]> {
    const result = await this.request('list_prompts');
    return isRecord(result) && Array.isArray(result['prompts'])
      ? (result['prompts'] as ListedPrompt[])
      : [];
  }

  async getPrompt(name: string, args: Record<string, string>): Promise<PromptResult> {
    return (await this.request('get_prompt', { name, args })) as PromptResult;
  }

  /** Close this session's connection. The backend keeps running. */
  close(): void {
    this.closed = true;
    this.socket?.end();
    this.socket = null;
    this.failAll(new Error('The session is closing'));
  }

  private async connectWithRetry(): Promise<Socket> {
    const maxAttempts = this.options.maxAttempts ?? 40;
    const maxDelay = this.options.maxDelayMs ?? 2000;
    let delay = this.options.firstDelayMs ?? 100;
    let spawned = false;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (this.closed) throw new Error('The session is closing');
      try {
        const socket = await this.connectOnce();
        this.adopt(socket);
        return socket;
      } catch (error) {
        lastError = error as Error;
        if (!spawned) {
          spawned = true;
          this.options.logger.info('No backend answered, starting one');
          try {
            this.options.spawnBackend();
          } catch (spawnError) {
            throw new Error(`Could not start the backend: ${(spawnError as Error).message}`);
          }
        }
      }
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(maxDelay, Math.round(delay * 1.5));
    }

    throw new Error(
      `No backend on ${this.options.host}:${this.options.port} after ${maxAttempts} attempts` +
        (lastError ? ` (${lastError.message})` : '')
    );
  }

  private connectOnce(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.options.host, port: this.options.port });
      socket.once('connect', () => {
        socket.off('error', reject);
        resolve(socket);
      });
      socket.once('error', reject);
    });
  }

  private adopt(socket: Socket): void {
    socket.setEncoding('utf8');
    socket.setNoDelay(true);
    this.socket = socket;
    const splitter = new LineSplitter();

    socket.on('data', (chunk: string) => {
      let lines: string[];
      try {
        lines = splitter.push(chunk);
      } catch (error) {
        socket.destroy(error as Error);
        return;
      }
      for (const line of lines) this.handleLine(line);
    });

    if (this.watchers.size) {
      this.requestWatch();
      if (this.everConnected) {
        this.emit({ type: 'tools_changed' });
        this.emit({ type: 'resources_changed' });
        this.emit({ type: 'prompts_changed' });
      }
    }
    this.everConnected = true;

    socket.on('error', error => this.options.logger.warn('Backend connection error', error));
    socket.on('close', () => {
      if (this.socket === socket) this.socket = null;
      this.failAll(new Error('Connection to the backend lost'));
      if (!this.closed) {
        // Reconnect in the background so the backend keeps counting this session.
        setTimeout(() => {
          if (!this.closed) this.ensureConnected().catch(() => undefined);
        }, 500).unref();
      }
    });
  }

  private handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(message)) return;
    const event = message['event'];
    if (isRecord(event) && typeof event['type'] === 'string') {
      this.emit(event as unknown as BackendEvent);
      return;
    }
    const id = message['id'];
    if (typeof id !== 'string' && typeof id !== 'number') {
      if (isRecord(message['error'])) {
        this.options.logger.warn('Backend reported an error without id', message['error']);
      }
      return;
    }
    const entry = this.pending.get(String(id));
    if (!entry) return;

    if (isRecord(message['progress'])) {
      const progress = message['progress'];
      if (typeof progress['progress'] === 'number')
        entry.onProgress?.(progress as unknown as ProgressPayload);
      return;
    }

    this.pending.delete(String(id));
    if (isRecord(message['error'])) {
      const text = message['error']['message'];
      entry.reject(new Error(typeof text === 'string' && text ? text : 'Backend unavailable'));
    } else {
      entry.resolve(message['result']);
    }
  }

  private failAll(error: Error): void {
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) entry.reject(error);
  }
}
