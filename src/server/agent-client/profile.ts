/**
 * An agent client profile: which Foundry, which user, and how the browser
 * behaves. Everything here is plain configuration; the password is never part
 * of a profile and lives in the secret store of the operating system.
 *
 * On disk, below the state folder of the server:
 *
 *   agent-clients/<name>/profile.json   this file
 *   agent-clients/<name>/browser/       the browser profile of this client
 *   agent-clients/<name>/password.dpapi the encrypted password (Windows only)
 *   agent-clients/<name>/control.json   how to reach the running client
 *   agent-clients/<name>/client.log     what the running client did
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODULE_ID } from '../../common/constants.js';
import { stateDir } from '../state-dir.js';

/** `world`: the client sets nothing and the world decides (a sheet view module, for example). */
export type CanvasMode = 'on' | 'off' | 'world';
/** `fallback`: hold the bridge only while no other browser does. */
export type BridgeMode = 'fallback' | 'on' | 'off';
/**
 * The installed Google Chrome by default. `msedge` for computers without Chrome,
 * `auto` tries Chrome and then Edge. Never a downloaded browser.
 */
export type BrowserChoice = 'auto' | 'chrome' | 'msedge';

export interface Profile {
  name: string;
  /** Address of Foundry with an optional route prefix, without a trailing slash. */
  url: string;
  /** Document id of the Foundry user, 16 letters and digits. Survives renaming the user. */
  userId: string;
  canvas: CanvasMode;
  bridge: BridgeMode;
  browser: BrowserChoice;
  width: number;
  height: number;
}

export const PROFILE_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const FOUNDRY_ID = /^[A-Za-z0-9]{16}$/;

const CANVAS_MODES: readonly CanvasMode[] = ['on', 'off', 'world'];
const BRIDGE_MODES: readonly BridgeMode[] = ['fallback', 'on', 'off'];
const BROWSERS: readonly BrowserChoice[] = ['auto', 'chrome', 'msedge'];

export class ProfileError extends Error {}

export function clientsDir(env?: Record<string, string | undefined>): string {
  return join(stateDir(env), 'agent-clients');
}

export function profileDir(name: string, env?: Record<string, string | undefined>): string {
  if (!PROFILE_NAME.test(name)) throw new ProfileError(`"${name}" is not a valid profile name`);
  return join(clientsDir(env), name);
}

/** `https://example.com/foundry/` becomes `https://example.com/foundry`. Only http and https. */
export function normalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ProfileError(`"${raw}" is not an address. Example: https://foundry.example.com`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new ProfileError(`"${raw}" must start with https:// or http://`);
  if (url.username || url.password)
    throw new ProfileError('The address must not contain a user name or password.');
  if (url.search || url.hash) throw new ProfileError('The address must not contain ? or #.');
  let path = url.pathname.replace(/\/+$/, '');
  // Someone pasted the address of the join or game page.
  path = path.replace(/\/(join|game|setup|auth|players)$/, '');
  return `${url.origin}${path}`;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value))
    return value as T;
  throw new ProfileError(`"${field}" must be one of: ${allowed.join(', ')}`);
}

function size(value: unknown, field: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 640 || value > 7680)
    throw new ProfileError(`"${field}" must be a whole number of pixels from 640 to 7680`);
  return value;
}

/** Checks raw data (a parsed profile.json, or command line options) and fills defaults. */
export function parseProfile(name: string, raw: Record<string, unknown>): Profile {
  if (!PROFILE_NAME.test(name))
    throw new ProfileError(
      `"${name}" is not a valid profile name: lowercase letters, digits and hyphens, at most 32`
    );
  if (typeof raw['url'] !== 'string') throw new ProfileError('"url" is missing');
  const userId = raw['userId'];
  if (typeof userId !== 'string' || !FOUNDRY_ID.test(userId))
    throw new ProfileError('"userId" must be the id of a Foundry user (16 letters and digits)');
  return {
    name,
    url: normalizeUrl(raw['url']),
    userId,
    canvas: raw['canvas'] === undefined ? 'world' : oneOf(raw['canvas'], CANVAS_MODES, 'canvas'),
    bridge: raw['bridge'] === undefined ? 'fallback' : oneOf(raw['bridge'], BRIDGE_MODES, 'bridge'),
    browser: raw['browser'] === undefined ? 'chrome' : oneOf(raw['browser'], BROWSERS, 'browser'),
    width: size(raw['width'], 'width', 1600),
    height: size(raw['height'], 'height', 900),
  };
}

export function readProfile(name: string, env?: Record<string, string | undefined>): Profile {
  const file = join(profileDir(name, env), 'profile.json');
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new ProfileError(
      `There is no agent client "${name}". Create it with: agent-client add ${name} ...`
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProfileError(`${file} is not valid JSON`);
  }
  if (!raw || typeof raw !== 'object') throw new ProfileError(`${file} is not a profile`);
  return parseProfile(name, raw as Record<string, unknown>);
}

export function writeProfile(profile: Profile, env?: Record<string, string | undefined>): string {
  const dir = profileDir(profile.name, env);
  mkdirSync(dir, { recursive: true });
  const { name: _name, ...stored } = profile;
  const file = join(dir, 'profile.json');
  writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`);
  return file;
}

export function listProfiles(env?: Record<string, string | undefined>): string[] {
  try {
    return readdirSync(clientsDir(env), { withFileTypes: true })
      .filter(entry => entry.isDirectory() && PROFILE_NAME.test(entry.name))
      .map(entry => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** Deletes the profile folder: configuration, browser profile, log, and the Windows password file. */
export function removeProfileDir(name: string, env?: Record<string, string | undefined>): void {
  rmSync(profileDir(name, env), { recursive: true, force: true });
}

/**
 * Client settings written into localStorage before every page load. Foundry
 * keeps client settings there as JSON under `<namespace>.<key>`.
 *
 * Deliberately few: a module that compares client settings with the account
 * asks the person about every difference, right on top of the page.
 */
export function clientSettings(profile: Profile): Record<string, string> {
  const settings: Record<string, string> = {
    [`${MODULE_ID}.bridgeOffOnDevice`]: JSON.stringify(profile.bridge === 'off'),
    [`${MODULE_ID}.bridgeFallbackOnDevice`]: JSON.stringify(profile.bridge === 'fallback'),
  };
  if (profile.canvas !== 'world')
    settings['core.noCanvas'] = JSON.stringify(profile.canvas === 'off');
  return settings;
}
