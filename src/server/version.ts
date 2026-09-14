import { readFileSync } from 'node:fs';

/**
 * The version from package.json. Unreadable means "unknown", never an
 * invented number: a made up version sends people looking for a release that
 * does not exist.
 */
export function readServerVersion(): string {
  try {
    // src/server and build/server both sit two levels below package.json.
    const data = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
    ) as {
      version?: unknown;
    };
    return typeof data.version === 'string' && data.version ? data.version : 'unknown';
  } catch {
    return 'unknown';
  }
}
