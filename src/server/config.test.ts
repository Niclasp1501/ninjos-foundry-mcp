import { describe, expect, it } from 'vitest';
import { readConfig } from './config.js';

describe('readConfig', () => {
  it('uses the documented defaults', () => {
    const { config, warnings } = readConfig({});
    expect(warnings).toEqual([]);
    expect(config).toMatchObject({
      serverName: 'ninjos-foundry-mcp',
      controlHost: '127.0.0.1',
      controlPort: 31414,
      bridgePort: 31415,
      signalingPort: 31416,
      bridgePath: '/foundry-mcp',
      idleShutdownMs: 60_000,
      remoteMode: false,
      queryTimeoutMs: 30_000,
      toolResponseMaxChars: 0,
      imagesEnabled: false,
      allowedOrigins: [],
    });
    expect(config.lockFile).toMatch(/foundry-mcp-backend\.lock$/);
  });

  it('reads the variables of the previous generation', () => {
    const { config } = readConfig({
      SERVER_NAME: 'custom',
      FOUNDRY_MCP_CONTROL_PORT: '41414',
      FOUNDRY_PORT: '41415',
      FOUNDRY_REMOTE_MODE: 'true',
      FOUNDRY_ALLOWED_ORIGINS: 'http://localhost:30000, https://*.forge-vtt.com',
      FOUNDRY_MCP_IDLE_SHUTDOWN_MS: '5000',
    });
    expect(config).toMatchObject({
      serverName: 'custom',
      controlPort: 41414,
      bridgePort: 41415,
      remoteMode: true,
      allowedOrigins: ['http://localhost:30000', 'https://*.forge-vtt.com'],
      idleShutdownMs: 5000,
    });
  });

  it('reads the query timeout in milliseconds, as the previous generation did', () => {
    expect(readConfig({ FOUNDRY_QUERY_TIMEOUT: '45000' })).toMatchObject({
      config: { queryTimeoutMs: 45_000 },
      warnings: [],
    });
    const short = readConfig({ FOUNDRY_QUERY_TIMEOUT: '45' });
    expect(short.config.queryTimeoutMs).toBe(45);
    expect(short.warnings[0]).toContain('milliseconds');
    for (const broken of ['0', '-5', 'soon']) {
      const result = readConfig({ FOUNDRY_QUERY_TIMEOUT: broken });
      expect(result.config.queryTimeoutMs).toBe(30_000);
      expect(result.warnings).toHaveLength(1);
    }
  });

  it('keeps the signaling port at 31416 unless the new variable moves it', () => {
    expect(readConfig({ FOUNDRY_PORT: '41415' }).config.signalingPort).toBe(31416);
    expect(readConfig({ FOUNDRY_SIGNALING_PORT: '41416' }).config.signalingPort).toBe(41416);
  });

  it('switches FOUNDRY_REMOTE_MODE on with "true" only, as the previous generation', () => {
    for (const raw of ['1', 'yes', 'on', 'TRUE']) {
      const { config, warnings } = readConfig({ FOUNDRY_REMOTE_MODE: raw });
      expect(config.remoteMode).toBe(false);
      expect(warnings).toEqual([
        `FOUNDRY_REMOTE_MODE="${raw}" stays off: only "true" switches it on`,
      ]);
    }
    expect(readConfig({ FOUNDRY_REMOTE_MODE: ' true ' })).toMatchObject({
      config: { remoteMode: true },
      warnings: [],
    });
  });

  it('lists the image tools only with a Gemini key, and never keeps the key itself', () => {
    expect(readConfig({}).config.imagesEnabled).toBe(false);
    expect(readConfig({ GEMINI_API_KEY: '   ' }).config.imagesEnabled).toBe(false);
    const { config } = readConfig({ GEMINI_API_KEY: 'secret-test-value' });
    expect(config.imagesEnabled).toBe(true);
    expect(JSON.stringify(config)).not.toContain('secret-test-value');
  });

  it('says that COMFYUI_ENABLED has no effect any more', () => {
    for (const raw of ['true', '1', 'false']) {
      const { config, warnings } = readConfig({ COMFYUI_ENABLED: raw });
      expect(config.imagesEnabled).toBe(false);
      expect(warnings).toEqual([
        expect.stringMatching(/COMFYUI_ENABLED has no effect.*GEMINI_API_KEY/),
      ]);
    }
  });

  it('warns about a broken port and keeps the default', () => {
    const { config, warnings } = readConfig({ FOUNDRY_PORT: 'abc' });
    expect(config.bridgePort).toBe(31415);
    expect(warnings[0]).toContain('FOUNDRY_PORT');
  });
});
