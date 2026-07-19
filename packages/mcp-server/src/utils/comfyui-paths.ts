/**
 * ComfyUI installation detection utilities
 */

import * as fs from 'fs';
import * as path from 'path';
import { isMac, isWindows } from './platform.js';

/**
 * Check if a directory contains a valid ComfyUI installation
 */
export function isValidComfyUIPath(dirPath: string): boolean {
  try {
    const mainPyPath = path.join(dirPath, 'main.py');
    return fs.existsSync(mainPyPath) && fs.statSync(mainPyPath).isFile();
  } catch (error) {
    return false;
  }
}

/**
 * Get common ComfyUI installation paths for the current platform
 */
function getCommonComfyUIPaths(): string[] {
  const paths: string[] = [];
  const home = process.env.HOME || process.env.USERPROFILE || '';

  if (isWindows()) {
    const localAppData = process.env.LOCALAPPDATA || 'C:\\Users\\Default\\AppData\\Local';

    // Windows paths
    paths.push(
      `${localAppData}\\FoundryMCPServer\\ComfyUI-headless`,
      `${localAppData}\\ComfyUI`,
      'C:\\ComfyUI',
      `${home}\\ComfyUI`
    );
  } else if (isMac()) {
    const appSupport = `${home}/Library/Application Support`;

    // Mac paths - prioritize headless installer using system Python
    paths.push(
      '/Applications/FoundryMCPServer.app/Contents/Resources/ComfyUI', // Headless install (uses system Python)
      `${appSupport}/FoundryMCPServer/ComfyUI-headless`,
      `${appSupport}/ComfyUI`,
      '/Applications/ComfyUI.app/Contents/Resources/ComfyUI', // Desktop app (legacy)
      `${home}/ComfyUI`,
      '/opt/ComfyUI',
      '/usr/local/ComfyUI'
    );
  } else {
    // Linux paths
    paths.push(
      `${home}/.local/share/FoundryMCPServer/ComfyUI-headless`,
      `${home}/ComfyUI`,
      '/opt/ComfyUI',
      '/usr/local/ComfyUI'
    );
  }

  return paths;
}

/**
 * Attempt to detect an existing ComfyUI installation
 * Returns the path if found, or null if not found
 */
export function detectComfyUIInstallation(): string | null {
  const commonPaths = getCommonComfyUIPaths();

  for (const dirPath of commonPaths) {
    if (isValidComfyUIPath(dirPath)) {
      return dirPath;
    }
  }

  return null;
}

/**
 * Get the ComfyUI Desktop download URL for Mac
 */
export function getComfyUIDesktopURL(): string {
  return 'https://www.comfy.org/download';
}

/**
 * Check if ComfyUI Desktop is likely installed on Mac
 */
export function isComfyUIDesktopInstalled(): boolean {
  if (!isMac()) {
    return false;
  }

  const appPath = '/Applications/ComfyUI.app';
  try {
    return fs.existsSync(appPath);
  } catch (error) {
    return false;
  }
}

/**
 * Get Python command for running ComfyUI on the current platform
 * For headless installs, returns the path to the venv Python
 */
export function getDefaultPythonCommand(installPath?: string): string {
  if (isWindows()) {
    // Windows: embedded Python in ComfyUI directory
    return 'python/python.exe';
  } else if (isMac()) {
    // Mac: Check for headless venv first, then fall back to system Python 3.11
    if (installPath) {
      const venvPython = path.join(installPath, 'venv', 'bin', 'python');
      if (fs.existsSync(venvPython)) {
        return venvPython;
      }
    }

    // Use system Python 3.11 installed by our installer
    const systemPython311 = '/Library/Frameworks/Python.framework/Versions/3.11/bin/python3';
    if (fs.existsSync(systemPython311)) {
      return systemPython311;
    }

    // Fallback to system Python
    return 'python3';
  } else {
    // Linux: system Python
    return 'python3';
  }
}
