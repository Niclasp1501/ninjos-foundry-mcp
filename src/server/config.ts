/**
 * Everything the server reads from the environment, in one place.
 *
 * The names of the previous generation stay: they are written into Claude
 * configurations and firewall rules. New names only add behaviour; none of
 * them changes what an existing variable means.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BRIDGE_PATH,
  DEFAULT_BRIDGE_PORT,
  DEFAULT_CONTROL_PORT,
  DEFAULT_SIGNALING_PORT,
  MODULE_ID,
} from '../common/constants.js';
import { DEFAULT_QUERY_TIMEOUT_MS } from '../common/timeouts.js';
import { defaultOriginStoreFile } from './bridge/connection-guards.js';

export interface ServerConfig {
  serverName: string;
  controlHost: string;
  controlPort: number;
  idleShutdownMs: number;
  bridgePort: number;
  bridgePath: string;
  remoteMode: boolean;
  allowedOrigins: string[];
  originStoreFile: string;
  signalingPort: number;
  /** false switches the WebRTC detour off entirely. */
  webrtcEnabled: boolean;
  queryTimeoutMs: number;
  /** 0 means no limit. */
  toolResponseMaxChars: number;
  /** GEMINI_API_KEY is set: the image tools of the group `maps` are listed. The key itself is not kept here. */
  imagesEnabled: boolean;
  /** Empty means every group. Entries starting with "!" switch a group off. */
  toolGroups: string[];
  lockFile: string;
  /** How long a call right after the backend started waits for the module to connect. */
  startupModuleWaitMs: number;
  logFile: string | null;
}

export type Env = Record<string, string | undefined>;

function port(env: Env, name: string, fallback: number, warnings: string[]): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  // 0 asks the system for a free port. Only the tests use that.
  if (Number.isInteger(value) && value >= 0 && value <= 65535) return value;
  warnings.push(`${name}="${raw}" is not a port number, using ${fallback}`);
  return fallback;
}

function number(env: Env, name: string, fallback: number, warnings: string[]): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (Number.isFinite(value) && value >= 0) return value;
  warnings.push(`${name}="${raw}" is not a non-negative number, using ${fallback}`);
  return fallback;
}

/** A switch of this generation: true, 1, yes and on count as on. */
function flag(env: Env, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

/**
 * A switch of the previous generation, off by default, where only `true`
 * switched it on.
 * `FOUNDRY_REMOTE_MODE=1` meant off there and keeps meaning off, with a warning,
 * so an old configuration never opens the bridge to the network by surprise.
 */
function onlyTrue(env: Env, name: string, warnings: string[]): boolean {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === '' || raw === 'false') return false;
  if (raw === 'true') return true;
  warnings.push(`${name}="${raw}" stays off: only "true" switches it on`);
  return false;
}

function list(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(/[,;\n]/)
    .map(entry => entry.trim())
    .filter(Boolean);
}

/**
 * FOUNDRY_QUERY_TIMEOUT, in milliseconds, exactly as the previous generation
 * reads it. A configuration
 * that works today keeps its meaning; "30" is 30 ms there and stays 30 ms here.
 *
 * Only what made every query fail at once before (0, negative, unreadable) falls
 * back to the default, with a warning. A value below one second is honoured
 * but warned about, because most queries cannot answer that fast.
 */
function queryTimeout(env: Env, warnings: string[]): number {
  const raw = env['FOUNDRY_QUERY_TIMEOUT'];
  if (raw === undefined || raw.trim() === '') return DEFAULT_QUERY_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    warnings.push(
      `FOUNDRY_QUERY_TIMEOUT="${raw}" is not a positive number of milliseconds, using ${DEFAULT_QUERY_TIMEOUT_MS}`
    );
    return DEFAULT_QUERY_TIMEOUT_MS;
  }
  if (value < 1000) {
    warnings.push(
      `FOUNDRY_QUERY_TIMEOUT="${raw}" is read as milliseconds; most queries fail with less than 1000`
    );
  }
  return value;
}

export function readConfig(env: Env = process.env): { config: ServerConfig; warnings: string[] } {
  const warnings: string[] = [];
  const path = env['FOUNDRY_NAMESPACE']?.trim() || BRIDGE_PATH;

  const config: ServerConfig = {
    serverName: env['SERVER_NAME']?.trim() || MODULE_ID,
    controlHost: env['FOUNDRY_MCP_CONTROL_HOST']?.trim() || '127.0.0.1',
    controlPort: port(env, 'FOUNDRY_MCP_CONTROL_PORT', DEFAULT_CONTROL_PORT, warnings),
    idleShutdownMs: number(env, 'FOUNDRY_MCP_IDLE_SHUTDOWN_MS', 60_000, warnings),
    bridgePort: port(env, 'FOUNDRY_PORT', DEFAULT_BRIDGE_PORT, warnings),
    bridgePath: path.startsWith('/') ? path : `/${path}`,
    remoteMode: onlyTrue(env, 'FOUNDRY_REMOTE_MODE', warnings),
    allowedOrigins: list(env['FOUNDRY_ALLOWED_ORIGINS']),
    originStoreFile: defaultOriginStoreFile(),
    // New name, the previous generation had no variable here. Modules of that
    // generation always post their offer to 31416, so moving the port cuts
    // every one of them off the detour.
    signalingPort: port(env, 'FOUNDRY_SIGNALING_PORT', DEFAULT_SIGNALING_PORT, warnings),
    webrtcEnabled: flag(env, 'FOUNDRY_WEBRTC', true),
    queryTimeoutMs: queryTimeout(env, warnings),
    toolResponseMaxChars: number(env, 'TOOL_RESPONSE_MAX_CHARS', 0, warnings),
    imagesEnabled: Boolean(env['GEMINI_API_KEY']?.trim()),
    toolGroups: list(env['FOUNDRY_MCP_TOOL_GROUPS']),
    lockFile: env['FOUNDRY_MCP_LOCK_FILE']?.trim() || join(tmpdir(), 'foundry-mcp-backend.lock'),
    startupModuleWaitMs: number(env, 'FOUNDRY_MCP_STARTUP_WAIT_MS', 10_000, warnings),
    logFile: env['FOUNDRY_MCP_LOG_FILE']?.trim() || null,
  };

  if (env['COMFYUI_ENABLED']?.trim())
    warnings.push(
      'COMFYUI_ENABLED has no effect any more: the ComfyUI map generator was removed in 14.2609.6. ' +
        'Battle maps now come from Gemini; set GEMINI_API_KEY to switch them on (see the installation guide).'
    );

  return { config, warnings };
}
