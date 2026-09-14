import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const moduleDir = new URL('../../module/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('module.json', moduleDir), 'utf8')) as {
  id: string;
  styles: string[];
  socket?: unknown;
};

describe('module.json socket', () => {
  it('declares the module socket, which Foundry needs to relay send-notification to other browsers', () => {
    expect(manifest.socket).toBe(true);
  });
});

describe('module.json stylesheets', () => {
  it('loads the brand first, so every package stylesheet can build on its tokens', () => {
    expect(manifest.id).toBe('ninjos-foundry-mcp');
    expect(manifest.styles[0]).toBe('styles/ninjo-marke.css');
  });

  it('lists every stylesheet once, and each one exists', () => {
    expect(new Set(manifest.styles).size).toBe(manifest.styles.length);
    for (const path of manifest.styles)
      expect(existsSync(new URL(path, moduleDir)), path).toBe(true);
  });

  it('lists the stylesheets packages used to attach themselves', () => {
    expect(manifest.styles).toEqual(
      expect.arrayContaining(['styles/interface.css', 'styles/campaign.css', 'styles/bridge.css'])
    );
  });
});
