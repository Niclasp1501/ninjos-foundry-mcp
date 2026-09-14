/**
 * Who may talk to this server.
 *
 * Until 14.2609.3 nobody was asked. The bridge on 31415 upgraded any WebSocket
 * whose path matched, the signaling server on 31416 answered every origin with
 * `Access-Control-Allow-Origin: *`, and both listened on every interface. So
 * any web page open in the GM's browser, and any machine on the same network,
 * could drive every tool the module exposes: scene, actor and journal writes
 * included. WebSockets have no same-origin policy; nothing in the browser stops
 * a page from connecting to localhost.
 *
 * The Origin header is the right discriminator: a browser always sends it on a
 * WebSocket handshake and on a cross-origin POST, and a page cannot forge it.
 *
 * What the right origin is cannot be hardcoded. It is `http://localhost:30000`
 * for a local Foundry, the GM's own domain for a hosted one, a
 * `*.forge-vtt.com` address on The Forge. Hence two modes:
 *
 * 1. **A configured list** (`FOUNDRY_ALLOWED_ORIGINS`) is the whole truth.
 *    Nothing is learned while it is set.
 * 2. **Without a list, the first origin is remembered** and kept in a file.
 *    Every later connection must come from that same origin. The module
 *    connects on its own as soon as the world loads, so in practice the first
 *    origin is the GM's Foundry. That is weaker than a list, and deliberately
 *    so: an update must not lock out everyone who has never heard of the
 *    variable.
 *
 * Found by 9atatimer while getting the server to run in their fork, 2026-09-12.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type OriginDecision =
  { allowed: true; learned?: boolean } | { allowed: false; reason: string };

interface GuardLogger {
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
}

export interface OriginGuardOptions {
  /** From FOUNDRY_ALLOWED_ORIGINS. When non-empty, nothing is learned. */
  configured: string[];
  /** Where a learned origin survives restarts. */
  storeFile: string;
  logger?: GuardLogger;
}

/**
 * Next to the installer on Windows, under ~/.config elsewhere.
 * FOUNDRY_MCP_STATE_DIR moves it, which is also what the tests use.
 */
export function defaultOriginStoreFile(): string {
  const base =
    process.env.FOUNDRY_MCP_STATE_DIR ||
    (process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, 'FoundryMCPServer')
      : join(homedir(), '.config', 'ninjos-foundry-mcp'));
  return join(base, 'allowed-origins.json');
}

export function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * `https://*.forge-vtt.com` matches any subdomain of forge-vtt.com over https.
 * `http://localhost:*` matches any port. The star stands for one or more host
 * labels or a port, never for a scheme, so `*` cannot quietly widen http into
 * https or the other way round.
 */
export function originMatches(pattern: string, origin: string): boolean {
  const p = normalizeOrigin(pattern);
  if (p === origin) return true;
  if (!p.includes('*')) return false;
  const expression = p
    .split('*')
    .map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[a-z0-9-]+(?:\\.[a-z0-9-]+)*');
  return new RegExp(`^${expression}$`).test(origin);
}

export class OriginGuard {
  private learned: string[] = [];

  constructor(private readonly options: OriginGuardOptions) {
    if (!options.configured.length) this.learned = this.load();
  }

  /** One line for the startup log, so the mode in force is never a guess. */
  describe(): string {
    if (this.options.configured.length) {
      return `list from FOUNDRY_ALLOWED_ORIGINS: ${this.options.configured.join(', ')}`;
    }
    return this.learned.length
      ? `remembered origin ${this.learned[0]} (${this.options.storeFile})`
      : `learning: the first Foundry that connects is remembered in ${this.options.storeFile}`;
  }

  /**
   * Decide about one connection.
   *
   * `learn: false` is for CORS preflights. A preflight grants nothing by itself,
   * so it must not be the request that teaches the guard an origin.
   */
  check(rawOrigin: string | undefined, { learn = true }: { learn?: boolean } = {}): OriginDecision {
    // Browsers always send Origin here. A request without one comes from a
    // local program, and a local program could reach the tools anyway.
    if (rawOrigin === undefined) return { allowed: true };

    const origin = normalizeOrigin(rawOrigin);
    const { configured } = this.options;

    if (configured.length) {
      if (configured.includes('*') || configured.some(p => originMatches(p, origin))) {
        return { allowed: true };
      }
      return { allowed: false, reason: `${origin} is not in FOUNDRY_ALLOWED_ORIGINS` };
    }

    if (this.learned.includes(origin)) return { allowed: true };

    if (this.learned.length) {
      return {
        allowed: false,
        reason:
          `${origin} is not the remembered Foundry origin ${this.learned[0]}. ` +
          `Set FOUNDRY_ALLOWED_ORIGINS, or delete ${this.options.storeFile} to learn again.`,
      };
    }

    // Sandboxed frames and file:// pages send the literal "null". Remembering
    // that would let every such page in.
    if (origin === 'null') {
      return { allowed: false, reason: 'an opaque origin ("null") is never remembered' };
    }

    if (!learn) return { allowed: true };

    this.learned = [origin];
    this.save();
    this.options.logger?.info(`Remembered ${origin} as the Foundry origin`, {
      file: this.options.storeFile,
    });
    return { allowed: true, learned: true };
  }

  private load(): string[] {
    try {
      const data = JSON.parse(readFileSync(this.options.storeFile, 'utf8'));
      return Array.isArray(data?.origins)
        ? data.origins.filter((o: unknown) => typeof o === 'string').map(normalizeOrigin)
        : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.options.storeFile), { recursive: true });
      writeFileSync(
        this.options.storeFile,
        JSON.stringify(
          {
            origins: this.learned,
            note:
              'The Foundry address this MCP server accepts connections from. ' +
              'Delete this file to have it remember the next one that connects, ' +
              'or set FOUNDRY_ALLOWED_ORIGINS to list addresses explicitly.',
          },
          null,
          2
        ) + '\n'
      );
    } catch (error) {
      // Kept in memory for this run. Next start learns again, which is no worse
      // than before this guard existed.
      this.options.logger?.warn('Could not store the remembered origin', {
        file: this.options.storeFile,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * True when a connection to the control channel opens like an HTTP request.
 *
 * The control channel speaks line-delimited JSON and skips lines it cannot
 * parse. A browser cannot open raw TCP, but it can POST to 127.0.0.1:31414:
 * the request line and headers would be skipped as garbage and the body line
 * would run as a tool call. No legitimate client ever starts with a request
 * line, so such a connection is dropped before anything is parsed.
 */
export function looksLikeHttpRequest(start: string): boolean {
  return /^[A-Z]{3,10} \S+ HTTP\/\d(?:\.\d)?\r?(?:\n|$)/.test(start);
}
