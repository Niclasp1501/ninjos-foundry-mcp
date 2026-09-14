/**
 * What the previous installers left on disk, and the entries kept at their paths.
 */
import { pathToFileURL } from 'node:url';
import type { PlatformPath } from 'node:path';

/**
 * Program files of the previous Windows installer inside its folder.
 *
 * Deliberately not here, because they are data or belong to something else:
 * `allowed-origins.json`, `logs`, `ComfyUI` with its models, `start-comfyui.bat`,
 * `test-comfyui.bat`, `comfyui.log`, `temp`. The old uninstaller deleted some of
 * those; a program file must never take user data with it.
 *
 * `Uninstall.exe` goes first: left behind, it would delete the files of this
 * installation in the same folder.
 */
export const LEGACY_WINDOWS_PROGRAM = [
  'Uninstall.exe',
  'node',
  'node_modules',
  'foundry-mcp-server',
  'configure-claude.ps1',
  'configure-claude-wrapper.bat',
  'start-server.bat',
  'test-connection.bat',
  'README.txt',
  'LICENSE.txt',
  'icon.ico',
] as const;

/** Marks a folder as an installation of the previous Windows installer. */
export const LEGACY_WINDOWS_MARKERS = ['Uninstall.exe', 'foundry-mcp-server'] as const;

/** The program folder of the previous macOS installer. Owned by root. */
export const LEGACY_MAC_APP = '/Applications/FoundryMCPServer.app';

export function legacyEntryDir(p: PlatformPath, root: string): string {
  return p.join(root, 'foundry-mcp-server', 'packages', 'mcp-server', 'dist');
}

function importLine(target: string, platform: NodeJS.Platform): string {
  const href = pathToFileURL(target, { windows: platform === 'win32' }).href;
  return [
    "'use strict';",
    "// Written by the setup of Ninjo's Foundry MCP. A client configured by the",
    '// previous installer starts this path; it hands over to the current server.',
    `import(${JSON.stringify(href)}).catch(function (error) {`,
    "  process.stderr.write(\"Ninjo's Foundry MCP could not start: \" + ((error && error.stack) || error) + '\\n');",
    '  process.exit(1);',
    '});',
    '',
  ].join('\n');
}

/**
 * `index.cjs` at the old entry path. CommonJS, because that is what the file
 * name promises to Node; the wrapper is an ES module and is loaded with import().
 */
export function wrapperShim(wrapper: string, platform: NodeJS.Platform): string {
  return importLine(wrapper, platform);
}

/**
 * `backend.bundle.cjs` next to it. A wrapper of the previous generation that is
 * still running looks for its backend under this name, and must start the new
 * backend, never an old file.
 */
export function backendShim(backend: string, platform: NodeJS.Platform): string {
  return importLine(backend, platform);
}

/** Start menu folder of the previous installer, with its link to Uninstall.exe. */
export function legacyStartMenu(p: PlatformPath, roamingAppData: string): string {
  return p.join(
    roamingAppData,
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Foundry MCP Server'
  );
}
