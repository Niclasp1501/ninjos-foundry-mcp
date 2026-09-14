import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mergeServerEntry, serverMatcher } from './client-config.js';
import {
  BACKUP_MARK,
  backupFile,
  detectFormat,
  formatJson,
  updateJsonFile,
} from './config-file.js';

let dir: string;
let file: string;
let clock: number;
const now = () => new Date(clock);

const desired = {
  command: '/opt/FoundryMCPServer/node',
  args: ['/opt/FoundryMCPServer/app/build/server/wrapper.js'],
};
const matcher = serverMatcher({ wrappers: desired.args, claimKey: true });
const addEntry = (value: unknown) => mergeServerEntry(value, desired, matcher, { add: true });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'client-config-'));
  file = join(dir, 'claude_desktop_config.json');
  clock = Date.UTC(2026, 8, 14, 10, 0, 0);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const backups = () => readdirSync(dir).filter(name => name.includes(BACKUP_MARK));

describe('updateJsonFile', () => {
  it('does not create a file that may not be created', () => {
    const outcome = updateJsonFile(file, addEntry, { create: false, now });
    expect(outcome.status).toBe('missing');
    expect(existsSync(file)).toBe(false);
  });

  it('creates a missing file with the entry, including its folder', () => {
    const nested = join(dir, 'Claude', 'claude_desktop_config.json');
    const outcome = updateJsonFile(nested, addEntry, { create: true, now });
    expect(outcome.status).toBe('created');
    expect(JSON.parse(readFileSync(nested, 'utf8'))).toEqual({
      mcpServers: { 'foundry-mcp': { ...desired, env: {} } },
    });
  });

  it('writes with a backup, keeps format, and leaves no backup when nothing changes', () => {
    const original =
      '﻿{\r\n\t"mcpServers": {\r\n\t\t"files": {\r\n\t\t\t"command": "npx"\r\n\t\t}\r\n\t}\r\n}\r\n';
    writeFileSync(file, original, 'utf8');
    const first = updateJsonFile(file, addEntry, { create: false, now });
    expect(first.status).toBe('written');
    expect(first.backup && readFileSync(first.backup, 'utf8')).toBe(original);

    const text = readFileSync(file, 'utf8');
    expect(text.startsWith('﻿{\r\n\t"mcpServers"')).toBe(true);
    expect(text.endsWith('}\r\n')).toBe(true);
    expect(text.includes('\n\t\t"files"')).toBe(true);
    expect(JSON.parse(text.slice(1))).toEqual({
      mcpServers: { files: { command: 'npx' }, 'foundry-mcp': { ...desired, env: {} } },
    });

    clock += 5000;
    const second = updateJsonFile(file, addEntry, { create: false, now });
    expect(second.status).toBe('unchanged');
    expect(backups()).toHaveLength(1);
  });

  it('never touches a file that is not valid JSON', () => {
    const broken = '{ "mcpServers": { "files": ';
    writeFileSync(file, broken, 'utf8');
    const outcome = updateJsonFile(file, addEntry, { create: true, now });
    expect(outcome.status).toBe('unreadable');
    expect(outcome.problem).toMatch(/not valid JSON/);
    expect(readFileSync(file, 'utf8')).toBe(broken);
    expect(backups()).toEqual([]);
  });

  it('never touches a file whose shape does not fit', () => {
    writeFileSync(file, '{"mcpServers": ["a"]}', 'utf8');
    const outcome = updateJsonFile(file, addEntry, { create: true, now });
    expect(outcome.status).toBe('unreadable');
    expect(readFileSync(file, 'utf8')).toBe('{"mcpServers": ["a"]}');
  });

  it('treats an empty file as an empty configuration, with a backup', () => {
    writeFileSync(file, '', 'utf8');
    const outcome = updateJsonFile(file, addEntry, { create: false, now });
    expect(outcome.status).toBe('written');
    expect(backups()).toHaveLength(1);
  });
});

describe('backupFile', () => {
  it('keeps only the newest backups of its own naming', () => {
    writeFileSync(file, '{}', 'utf8');
    const foreign = join(dir, 'claude_desktop_config.json.backup-20260101-000000');
    writeFileSync(foreign, '{}', 'utf8');
    const made: string[] = [];
    for (let n = 0; n < 5; n += 1) made.push(backupFile(file, new Date(clock + n * 1000), 3));
    expect(backups()).toHaveLength(3);
    expect(existsSync(made[4] as string)).toBe(true);
    expect(existsSync(made[0] as string)).toBe(false);
    expect(existsSync(foreign)).toBe(true);
  });
});

describe('format', () => {
  it('reads two spaces and a missing final newline back as written', () => {
    const text = '{\n  "a": 1\n}';
    expect(formatJson(JSON.parse(text), detectFormat(text))).toBe(text);
  });
});
