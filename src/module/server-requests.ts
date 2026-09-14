/**
 * Requests from the module to the server, the module's side.
 *
 * An area calls `requestServer` from core-services.ts. The failures a package
 * has to tell apart carry a code:
 *
 * - `NOT_CONNECTED`: no bridge in this browser (a player, or the bridge is down)
 * - `SERVER_TOO_OLD`: the server does not accept requests, or not this one.
 *   Nothing was sent to a server that did not announce the feature, so an old
 *   server never sees the message type.
 * - `TIMEOUT`: no answer in time; the server may still have done it
 * - `CONNECTION_LOST`: the bridge closed before the answer came
 * - any code the server's handler threw (`INVALID_ARGUMENT`, `NOT_AVAILABLE`,
 *   ...), `SERVER_ERROR` when it threw without one
 */

export class ServerRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** The code the server sent, when the failure came from the server. */
    readonly serverCode?: string
  ) {
    super(message);
    this.name = 'ServerRequestError';
  }
}

export interface ServerRequestOptions {
  /** Default 15 seconds, at most 10 minutes. */
  timeoutMs?: number;
}

export const DEFAULT_SERVER_REQUEST_TIMEOUT_MS = 15_000;
export const MAX_SERVER_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

export function serverRequestTimeout(options: ServerRequestOptions = {}): number {
  const wanted = options.timeoutMs;
  if (typeof wanted !== 'number' || !Number.isFinite(wanted) || wanted <= 0)
    return DEFAULT_SERVER_REQUEST_TIMEOUT_MS;
  return Math.min(Math.ceil(wanted), MAX_SERVER_REQUEST_TIMEOUT_MS);
}

/** The server does not accept requests at all, or not this one. */
export function isServerTooOld(error: unknown): boolean {
  return error instanceof ServerRequestError && error.code === 'SERVER_TOO_OLD';
}

export function serverTooOld(method: string): ServerRequestError {
  return new ServerRequestError(
    'SERVER_TOO_OLD',
    `The MCP server on the PC does not accept the request "${method}": it is older than this module. ` +
      'Nothing was sent and nothing was done. Update the MCP server on the PC and start it again.'
  );
}

/** A failed `server-response` as the error the caller gets. */
export function serverFailure(error: string, code: string | undefined): ServerRequestError {
  if (code === 'UNKNOWN_REQUEST') return new ServerRequestError('SERVER_TOO_OLD', error, code);
  return new ServerRequestError(code ?? 'SERVER_ERROR', error, code);
}

/** What core-services.ts uses to send; main.ts puts the bridge client behind it. */
export interface ServerRequestChannel {
  request(method: string, data: unknown, options: ServerRequestOptions): Promise<unknown>;
  /** Whether the connected server announced requests. False while not connected. */
  available(): boolean;
}
