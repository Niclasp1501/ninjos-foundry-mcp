/**
 * How the command line reaches a running agent client: a named pipe on
 * Windows, a Unix socket elsewhere, one JSON line per request and answer.
 *
 * Every request carries a random token from control.json in the profile
 * folder. That folder belongs to the user (inside the user folder), so
 * another account on the same machine cannot drive the browser through the
 * pipe even though it can see that the pipe exists.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import type { ClientState } from './page.js';

export const COMMANDS = ['status', 'js', 'screenshot', 'reload', 'stop', 'log'] as const;
export type Command = (typeof COMMANDS)[number];

export interface ControlRequest {
  token: string;
  command: Command;
  /** Only for `js`. */
  code?: string;
}

export interface ClientStatus {
  name: string;
  url: string;
  userId: string;
  state: ClientState;
  since: string;
  message?: string;
  hint: string;
  pid: number;
  visible: boolean;
  browser?: string;
  /** Only while logged in. */
  loggedInAs?: string;
  role?: number;
  world?: string;
  socketConnected?: boolean;
  canvas?: boolean;
  bridge?: { state: string; role?: string } | null;
  renderer?: string | null;
  softwareRendering?: boolean;
}

export type ControlResponse =
  | { ok: true; status?: ClientStatus; result?: unknown; png?: string; lines?: string[] }
  | { ok: false; error: string; status?: ClientStatus };

export interface ControlInfo {
  endpoint: string;
  token: string;
  pid: number;
  startedAt: string;
}

export function controlFile(dir: string): string {
  return join(dir, 'control.json');
}

export function endpointFor(platform: NodeJS.Platform, dir: string, name: string): string {
  if (platform === 'win32') {
    // Pipe names are global on the machine: the folder makes them unique per user and installation.
    const tag = createHash('sha256').update(dir.toLowerCase()).digest('hex').slice(0, 12);
    return `\\\\.\\pipe\\ninjos-foundry-mcp-agent-${name}-${tag}`;
  }
  return join(dir, 'control.sock');
}

function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Starts the control channel and writes control.json. Throws when another client already listens. */
export async function serveControl(
  dir: string,
  name: string,
  handle: (request: ControlRequest) => Promise<ControlResponse>
): Promise<{ server: Server; close: () => void }> {
  const endpoint = endpointFor(process.platform, dir, name);
  const token = randomBytes(32).toString('hex');
  if (process.platform !== 'win32') rmSync(endpoint, { force: true });

  const server = createServer((socket: Socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      buffer += chunk;
      const end = buffer.indexOf('\n');
      if (end === -1) {
        if (buffer.length > 1_000_000) socket.destroy();
        return;
      }
      const line = buffer.slice(0, end);
      buffer = '';
      void (async () => {
        let answer: ControlResponse;
        try {
          const request = JSON.parse(line) as ControlRequest;
          if (typeof request.token !== 'string' || !sameToken(request.token, token)) {
            answer = { ok: false, error: 'Not allowed' };
          } else {
            answer = await handle(request);
          }
        } catch (error) {
          answer = { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
        socket.end(`${JSON.stringify(answer)}\n`);
      })();
    });
    socket.on('error', () => undefined);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpoint, () => {
      server.off('error', reject);
      resolve();
    });
  });
  if (process.platform !== 'win32') chmodSync(endpoint, 0o600);

  const info: ControlInfo = {
    endpoint,
    token,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(controlFile(dir), `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 });

  return {
    server,
    close: () => {
      server.close();
      rmSync(controlFile(dir), { force: true });
      if (process.platform !== 'win32') rmSync(endpoint, { force: true });
    },
  };
}

export function readControlInfo(dir: string): ControlInfo | null {
  try {
    return JSON.parse(readFileSync(controlFile(dir), 'utf8')) as ControlInfo;
  } catch {
    return null;
  }
}

export class NotRunningError extends Error {}

/** Sends one request to the running client of `dir`. */
export function askClient(
  dir: string,
  request: Omit<ControlRequest, 'token'>,
  timeoutMs = 90_000
): Promise<ControlResponse> {
  const info = readControlInfo(dir);
  if (!info) return Promise.reject(new NotRunningError('The client is not running'));
  return new Promise((resolve, reject) => {
    const socket = connect(info.endpoint);
    let buffer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`No answer from the client within ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    socket.setEncoding('utf8');
    socket.on('connect', () =>
      socket.write(`${JSON.stringify({ ...request, token: info.token })}\n`)
    );
    socket.on('data', chunk => (buffer += chunk));
    socket.on('end', () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(buffer.trim()) as ControlResponse);
      } catch {
        reject(new Error('The client gave an answer that could not be read'));
      }
    });
    socket.on('error', error => {
      clearTimeout(timer);
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ECONNREFUSED')
        reject(new NotRunningError('The client is not running'));
      else reject(error);
    });
  });
}
