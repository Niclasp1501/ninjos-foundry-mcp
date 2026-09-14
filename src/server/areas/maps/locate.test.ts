/**
 * One search order for every system, the portable layout of the Windows
 * installer, and the Python that belongs to an installation.
 */
import { posix, win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applicationDataDir, locateComfyUI, searchPlaces, type LocateOptions } from './locate.js';

const WINDOWS: LocateOptions = {
  platform: 'win32',
  home: 'C:\\Users\\example',
  localAppData: 'C:\\Users\\example\\AppData\\Local',
  exists: () => false,
};
const MAC: LocateOptions = { platform: 'darwin', home: '/Users/example', exists: () => false };
const LINUX: LocateOptions = { platform: 'linux', home: '/home/example', exists: () => false };

const having = (options: LocateOptions, paths: string[]): LocateOptions => ({
  ...options,
  exists: path => paths.includes(path),
});

describe('searchPlaces', () => {
  it('searches the same five places in the same order on Windows, macOS and Linux', () => {
    for (const [options, path] of [
      [WINDOWS, win32],
      [MAC, posix],
      [LINUX, posix],
    ] as const) {
      const data = applicationDataDir(options);
      expect(searchPlaces(options)).toEqual([
        path.join(data, 'ComfyUI-headless'),
        path.join(data, 'ComfyUI'),
        '/Applications/FoundryMCPServer.app/Contents/Resources/ComfyUI',
        path.join(options.home, 'ComfyUI'),
        path.join(options.home, 'Documents', 'ComfyUI'),
      ]);
    }
    expect(applicationDataDir(WINDOWS)).toBe(
      'C:\\Users\\example\\AppData\\Local\\FoundryMCPServer'
    );
    expect(applicationDataDir(MAC)).toBe(
      '/Users/example/Library/Application Support/FoundryMCPServer'
    );
    expect(applicationDataDir(LINUX)).toBe('/home/example/.local/share/FoundryMCPServer');
  });

  it('searches only COMFYUI_INSTALL_PATH when it is set', () => {
    expect(searchPlaces({ ...LINUX, installPath: '/srv/comfy' })).toEqual(['/srv/comfy']);
  });
});

describe('locateComfyUI', () => {
  it('finds the portable layout of the Windows installer with its own Python', () => {
    const root = 'C:\\Users\\example\\AppData\\Local\\FoundryMCPServer\\ComfyUI';
    const result = locateComfyUI(
      having(WINDOWS, [`${root}\\ComfyUI\\main.py`, `${root}\\python_embeded\\python.exe`])
    );
    expect(result).toMatchObject({
      found: true,
      installation: {
        root,
        workDir: `${root}\\ComfyUI`,
        mainPy: `${root}\\ComfyUI\\main.py`,
        python: `${root}\\python_embeded\\python.exe`,
        pythonArgs: ['-s'],
        portable: true,
      },
    });
  });

  it('prefers a virtual environment on macOS and falls back to python3 on Linux', () => {
    const mac = locateComfyUI(
      having(MAC, ['/Users/example/ComfyUI/main.py', '/Users/example/ComfyUI/.venv/bin/python'])
    );
    expect(mac).toMatchObject({
      found: true,
      installation: { python: '/Users/example/ComfyUI/.venv/bin/python', portable: false },
    });

    const linux = locateComfyUI(having(LINUX, ['/home/example/Documents/ComfyUI/main.py']));
    expect(linux).toMatchObject({
      found: true,
      installation: { python: 'python3', pythonArgs: [] },
    });
  });

  it('takes the earlier place when two hold an installation', () => {
    const data = '/home/example/.local/share/FoundryMCPServer';
    const result = locateComfyUI(
      having(LINUX, [`${data}/ComfyUI-headless/main.py`, '/home/example/ComfyUI/main.py'])
    );
    expect(result).toMatchObject({
      found: true,
      installation: { root: `${data}/ComfyUI-headless` },
    });
  });

  it('does not look elsewhere when COMFYUI_INSTALL_PATH holds no main.py, and says so', () => {
    const result = locateComfyUI({
      ...having(LINUX, ['/home/example/ComfyUI/main.py']),
      installPath: '/srv/comfy',
    });
    expect(result.found).toBe(false);
    expect(result.searched).toEqual(['/srv/comfy/main.py', '/srv/comfy/ComfyUI/main.py']);
    expect(result).toMatchObject({
      problem: expect.stringContaining('COMFYUI_INSTALL_PATH="/srv/comfy" holds no main.py'),
    });
  });

  it('names a configured Python that does not exist', () => {
    const result = locateComfyUI({
      ...having(LINUX, ['/home/example/ComfyUI/main.py']),
      pythonCommand: 'env/bin/python',
    });
    expect(result).toMatchObject({
      found: false,
      problem:
        'COMFYUI_PYTHON_COMMAND="env/bin/python" points to /home/example/ComfyUI/env/bin/python, which does not exist.',
    });
    const command = locateComfyUI({
      ...having(LINUX, ['/home/example/ComfyUI/main.py']),
      pythonCommand: 'python3.11',
    });
    expect(command).toMatchObject({ found: true, installation: { python: 'python3.11' } });
  });

  it('lists every place it searched when nothing is found', () => {
    const result = locateComfyUI(MAC);
    expect(result.found).toBe(false);
    expect(result.searched).toHaveLength(10);
    expect(result).toMatchObject({
      problem: expect.stringContaining('ComfyUI installation not found'),
    });
  });
});
