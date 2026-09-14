/**
 * The tool directory of the previous generation as test data: name,
 * description and input schema of every tool it offered. The contract tests
 * compare the tools of this server against it, so a renamed tool or a changed
 * parameter fails a test instead of a user's instructions.
 *
 * The file lives inside this tree so the tests run in any checkout.
 */
import { readFileSync } from 'node:fs';

export const TOOL_DIRECTORY_URL = new URL('./fixtures/tool-directory.json', import.meta.url);

export interface DirectoryTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Every tool of the directory, in its order. */
export function readToolDirectory(): DirectoryTool[] {
  return JSON.parse(readFileSync(TOOL_DIRECTORY_URL, 'utf8')) as DirectoryTool[];
}
