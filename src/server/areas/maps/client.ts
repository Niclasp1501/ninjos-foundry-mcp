/**
 * Talking to ComfyUI over its HTTP and WebSocket interface.
 *
 * Only used while a job runs. Nothing here reconnects on its own: when the
 * progress socket breaks, the job keeps polling the history, so the result
 * is still found (in the previous generation, after five failed reconnects no
 * progress came any more, and progress of two jobs mixed).
 */
import WebSocket from 'ws';
import { MapsError, messageOf } from './errors.js';
import { OUTPUT_NODE, type ComfyGraph } from './workflow.js';

export interface ComfyImageRef {
  filename: string;
  subfolder: string;
  type: string;
}

export type HistoryState =
  | { state: 'done'; image: ComfyImageRef }
  | { state: 'error'; message: string }
  | { state: 'unknown' };

export interface ComfyQueue {
  running: string[];
  pending: string[];
}

export interface ComfyClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
}

export interface ProgressWatch {
  /** Resolves when the socket is open, or when it failed; never rejects. */
  ready: Promise<void>;
  close(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function linked(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** The choices of a combo input in /object_info, in the old and the new form. */
function comboChoices(info: unknown, node: string, field: string): string[] {
  const entry = isRecord(info) ? info[node] : undefined;
  const input = isRecord(entry) ? entry['input'] : undefined;
  const required = isRecord(input) ? input['required'] : undefined;
  const spec = isRecord(required) ? required[field] : undefined;
  if (!Array.isArray(spec)) return [];
  const first = spec[0];
  if (Array.isArray(first)) return first.filter((name): name is string => typeof name === 'string');
  const options = isRecord(spec[1]) ? spec[1]['options'] : undefined;
  if (first === 'COMBO' && Array.isArray(options))
    return options.filter((name): name is string => typeof name === 'string');
  return [];
}

function idsOf(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .map(item => (Array.isArray(item) ? item[1] : undefined))
    .filter((id): id is string => typeof id === 'string');
}

/** Node's fetch as it was at load, so nothing that later replaces the global reaches ComfyUI. */
const nodeFetch: typeof fetch = globalThis.fetch;

export class ComfyClient {
  readonly #fetch: typeof fetch;
  readonly #timeout: number;

  constructor(private readonly options: ComfyClientOptions) {
    this.#fetch = options.fetch ?? nodeFetch;
    this.#timeout = options.requestTimeoutMs ?? 30_000;
  }

  async #request(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.options.baseUrl}${path}`, {
        ...init,
        signal: linked(signal, this.#timeout),
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      throw new MapsError(
        'COMFYUI_UNREACHABLE',
        `ComfyUI at ${this.options.baseUrl} did not answer ${path}: ${messageOf(error)}`
      );
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new MapsError(
        response.status === 400 ? 'WORKFLOW_REJECTED' : 'COMFYUI_HTTP',
        `ComfyUI answered ${path} with HTTP ${response.status}${body ? `: ${body.slice(0, 800)}` : ''}`,
        response.status !== 400
      );
    }
    return response;
  }

  async #json(path: string, init?: RequestInit, signal?: AbortSignal): Promise<unknown> {
    const response = await this.#request(path, init, signal);
    try {
      return await response.json();
    } catch (error) {
      throw new MapsError(
        'COMFYUI_HTTP',
        `ComfyUI answered ${path} with something that is not JSON: ${messageOf(error)}`
      );
    }
  }

  async checkpoints(signal?: AbortSignal): Promise<string[]> {
    return comboChoices(
      await this.#json('/object_info/CheckpointLoaderSimple', {}, signal),
      'CheckpointLoaderSimple',
      'ckpt_name'
    );
  }

  async vaes(signal?: AbortSignal): Promise<string[]> {
    return comboChoices(
      await this.#json('/object_info/VAELoader', {}, signal),
      'VAELoader',
      'vae_name'
    );
  }

  async submit(graph: ComfyGraph, clientId: string, signal?: AbortSignal): Promise<string> {
    const body = await this.#json(
      '/prompt',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: graph, client_id: clientId }),
      },
      signal
    );
    const id = isRecord(body) ? body['prompt_id'] : undefined;
    if (typeof id !== 'string' || !id)
      throw new MapsError(
        'WORKFLOW_REJECTED',
        `ComfyUI did not accept the workflow: ${JSON.stringify(body).slice(0, 800)}`,
        false
      );
    return id;
  }

  async history(promptId: string, signal?: AbortSignal): Promise<HistoryState> {
    const body = await this.#json(`/history/${encodeURIComponent(promptId)}`, {}, signal);
    const entry = isRecord(body) ? body[promptId] : undefined;
    if (!isRecord(entry)) return { state: 'unknown' };
    const status = isRecord(entry['status']) ? entry['status'] : {};
    if (status['status_str'] === 'error') {
      const messages = Array.isArray(status['messages']) ? status['messages'] : [];
      const details = messages
        .filter((m): m is [string, unknown] => Array.isArray(m) && typeof m[0] === 'string')
        .filter(([kind]) => kind === 'execution_error' || kind === 'execution_interrupted')
        .map(([kind, data]) => {
          if (kind === 'execution_interrupted') return 'the generation was interrupted';
          const info = isRecord(data) ? data : {};
          return `${String(info['node_type'] ?? 'a node')} failed: ${String(info['exception_message'] ?? 'no message')}`;
        });
      return {
        state: 'error',
        message: details.join('; ') || 'ComfyUI reported an error without details',
      };
    }
    const outputs = isRecord(entry['outputs']) ? entry['outputs'] : {};
    const node = isRecord(outputs[OUTPUT_NODE]) ? outputs[OUTPUT_NODE] : {};
    const images = Array.isArray(node['images']) ? node['images'] : [];
    const first: unknown = images[0];
    if (isRecord(first) && typeof first['filename'] === 'string') {
      return {
        state: 'done',
        image: {
          filename: first['filename'],
          subfolder: typeof first['subfolder'] === 'string' ? first['subfolder'] : '',
          type: typeof first['type'] === 'string' ? first['type'] : 'temp',
        },
      };
    }
    if (status['completed'] === true)
      return { state: 'error', message: 'ComfyUI finished the workflow but produced no image' };
    return { state: 'unknown' };
  }

  async queue(signal?: AbortSignal): Promise<ComfyQueue> {
    const body = await this.#json('/queue', {}, signal);
    return {
      running: idsOf(isRecord(body) ? body['queue_running'] : undefined),
      pending: idsOf(isRecord(body) ? body['queue_pending'] : undefined),
    };
  }

  /** Stop exactly this prompt: interrupt it when it runs, remove it when it waits. */
  async stopPrompt(promptId: string): Promise<'interrupted' | 'removed' | 'not-there'> {
    const queue = await this.queue();
    if (queue.running.includes(promptId)) {
      await this.#request('/interrupt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt_id: promptId }),
      });
      return 'interrupted';
    }
    if (queue.pending.includes(promptId)) {
      await this.#request('/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delete: [promptId] }),
      });
      return 'removed';
    }
    return 'not-there';
  }

  async image(ref: ComfyImageRef, signal?: AbortSignal): Promise<Uint8Array> {
    const query = new URLSearchParams({
      filename: ref.filename,
      subfolder: ref.subfolder,
      type: ref.type,
    });
    const response = await this.#request(`/view?${query.toString()}`, {}, signal);
    return new Uint8Array(await response.arrayBuffer());
  }

  /**
   * Step progress of one client id. Messages of other prompts are ignored, so
   * two jobs never mix. `onEnd` is called once when the socket closes.
   */
  watch(
    clientId: string,
    onProgress: (promptId: string | null, value: number, max: number) => void,
    onEnd: (reason: string) => void
  ): ProgressWatch {
    const url = `${this.options.baseUrl.replace(/^http/, 'ws')}/ws?clientId=${encodeURIComponent(clientId)}`;
    let ended = false;
    const end = (reason: string) => {
      if (ended) return;
      ended = true;
      onEnd(reason);
    };
    const socket = new WebSocket(url);
    const ready = new Promise<void>(resolve => {
      socket.once('open', () => resolve());
      socket.once('error', () => resolve());
      socket.once('close', () => resolve());
    });
    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      let message: unknown;
      try {
        message = JSON.parse(String(data));
      } catch {
        return;
      }
      if (!isRecord(message) || message['type'] !== 'progress' || !isRecord(message['data']))
        return;
      const info = message['data'];
      const value = Number(info['value']);
      const max = Number(info['max']);
      if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return;
      onProgress(typeof info['prompt_id'] === 'string' ? info['prompt_id'] : null, value, max);
    });
    socket.on('error', error => end(messageOf(error)));
    socket.on('close', () => end('closed'));
    return {
      ready,
      close: () => {
        ended = true;
        try {
          socket.close();
        } catch {
          socket.terminate();
        }
      },
    };
  }
}
