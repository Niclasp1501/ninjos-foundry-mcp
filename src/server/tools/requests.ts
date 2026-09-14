/**
 * Requests from the module to the server.
 *
 * The bridge was built for one direction: the server asks, the module answers.
 * A window in Foundry that wants to start a service on the PC had to wait for
 * a query the server kept open (the maps area). Now an area names handlers for
 * requests, and the module sends `server-request` to a server that announced
 * the feature in `welcome`.
 *
 * A request comes from a connection that passed the origin check, which only
 * the client of a Gamemaster opens. Its data is still untrusted input: a
 * handler checks it like tool arguments and never runs anything it names.
 */
import type { Logger } from '../logger.js';

export type ServerRequestErrorCode =
  'UNKNOWN_REQUEST' | 'INVALID_ARGUMENT' | 'NOT_AVAILABLE' | 'SERVER_ERROR' | (string & {});

/** Throw this from a handler to send a code the module can act on. */
export class ServerRequestError extends Error {
  constructor(
    readonly code: ServerRequestErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ServerRequestError';
  }
}

/** The connection a request came from. */
export interface RequestConnection {
  id: string;
  /** `active` holds the bridge; `standby` is an older tab or world. */
  role: 'active' | 'standby';
  protocol: number;
  world?: string;
  user?: string;
}

export interface ServerRequestContext {
  connection: RequestConnection;
  /** The log of the area that registered the handler. */
  logger: Logger;
}

export interface ServerRequestDefinition {
  /** The request name, or several spellings for the same handler. Short names, no module prefix. */
  names: string | readonly string[];
  run(data: unknown, context: ServerRequestContext): unknown;
}

interface Entry {
  area: string;
  definition: ServerRequestDefinition;
}

export class ServerRequestRegistry {
  private readonly handlers = new Map<string, Entry>();

  constructor(private readonly loggerFor: (area: string) => Logger) {}

  /** A name that already has a handler stops the start, with both owners. */
  register(definition: ServerRequestDefinition, area = 'core'): void {
    const names = typeof definition.names === 'string' ? [definition.names] : [...definition.names];
    if (names.length === 0) throw new Error(`A server request of area "${area}" has no name`);
    for (const name of names) {
      const owner = this.handlers.get(name);
      if (owner)
        throw new Error(
          `The server request "${name}" of area "${area}" is already registered by area "${owner.area}"`
        );
    }
    for (const name of names) this.handlers.set(name, { area, definition });
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }

  names(): string[] {
    return [...this.handlers.keys()].sort();
  }

  /** Run the handler of one request. Unknown names fail with UNKNOWN_REQUEST. */
  async handle(method: string, data: unknown, connection: RequestConnection): Promise<unknown> {
    const entry = this.handlers.get(method);
    if (!entry) {
      throw new ServerRequestError(
        'UNKNOWN_REQUEST',
        `The MCP server does not know the request "${method}", so it is older than the Foundry module ` +
          'or the part of the server that answers it is missing. Update the MCP server on the PC.'
      );
    }
    return await entry.definition.run(data, { connection, logger: this.loggerFor(entry.area) });
  }
}
