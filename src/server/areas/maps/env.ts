/**
 * What the map generator reads from the environment.
 *
 * COMFYUI_ENABLED itself is read by the core (config.ts) and switches the
 * group; nothing here runs unless it is on. Every other name is one the
 * previous generation already read, so a
 * configuration keeps its meaning; the ones that had no effect there have one
 * now. COMFYUI_JOB_TIMEOUT_MS is new.
 */
import { isLoopbackHost } from './loopback.js';

export type Env = Record<string, string | undefined>;

export const DEFAULT_COMFYUI_PORT = 31411;
export const DEFAULT_JOB_TIMEOUT_MS = 30 * 60 * 1000;

export interface MapsEnv {
  host: string;
  port: number;
  /** COMFYUI_INSTALL_PATH: when set, the only place searched. */
  installPath?: string;
  /** COMFYUI_PYTHON_COMMAND: a path (relative to the installation) or a command name. */
  pythonCommand?: string;
  /** FOUNDRY_MCP_AUTOSTART_COMFYUI: start ComfyUI as soon as the map runtime starts. */
  autoStart: boolean;
  /** Longest time one job may run, from its start to its scene. */
  jobTimeoutMs: number;
}

export interface MapsEnvReading {
  env: MapsEnv;
  /** Values that make the generator refuse to run, each with its cause. */
  problems: string[];
}

function text(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

export function readMapsEnv(env: Env): MapsEnvReading {
  const problems: string[] = [];

  const host = text(env, 'COMFYUI_HOST') ?? '127.0.0.1';
  if (!isLoopbackHost(host)) {
    problems.push(
      `COMFYUI_HOST="${host}" is not a loopback address. The map generator only talks to a ComfyUI on this PC ` +
        '(127.0.0.1, localhost or ::1), because ComfyUI has no authentication of its own.'
    );
  }

  let port = DEFAULT_COMFYUI_PORT;
  const rawPort = text(env, 'COMFYUI_PORT');
  if (rawPort !== undefined) {
    const value = Number(rawPort);
    if (Number.isInteger(value) && value >= 1024 && value <= 65535) port = value;
    else problems.push(`COMFYUI_PORT="${rawPort}" is not a port number from 1024 to 65535.`);
  }

  let jobTimeoutMs = DEFAULT_JOB_TIMEOUT_MS;
  const rawTimeout = text(env, 'COMFYUI_JOB_TIMEOUT_MS');
  if (rawTimeout !== undefined) {
    const value = Number(rawTimeout);
    if (Number.isFinite(value) && value >= 60_000) jobTimeoutMs = value;
    else
      problems.push(
        `COMFYUI_JOB_TIMEOUT_MS="${rawTimeout}" is not a number of milliseconds of at least 60000.`
      );
  }

  const reading: MapsEnvReading = {
    env: {
      host,
      port,
      autoStart: text(env, 'FOUNDRY_MCP_AUTOSTART_COMFYUI')?.toLowerCase() === 'true',
      jobTimeoutMs,
    },
    problems,
  };
  const installPath = text(env, 'COMFYUI_INSTALL_PATH');
  if (installPath) reading.env.installPath = installPath;
  const pythonCommand = text(env, 'COMFYUI_PYTHON_COMMAND');
  if (pythonCommand) reading.env.pythonCommand = pythonCommand;
  return reading;
}

/** The address as it goes into a URL, with brackets around IPv6. */
export function hostForUrl(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}
