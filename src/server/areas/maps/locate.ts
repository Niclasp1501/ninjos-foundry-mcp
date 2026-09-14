/**
 * Where ComfyUI is, and with which Python it starts.
 *
 * One search order for every operating system (the two
 * start paths of the previous generation searched differently, and the
 * button path knew only Windows). A place that does not exist on a system is
 * simply not found there. The locations are the ones the installers used,
 * plus the usual folders a user clones ComfyUI into.
 *
 * 1. COMFYUI_INSTALL_PATH, and when it is set nothing else
 * 2. <application data>/ComfyUI-headless
 * 3. <application data>/ComfyUI (Windows installer; portable archive one level deeper)
 * 4. /Applications/FoundryMCPServer.app/Contents/Resources/ComfyUI (Mac installer)
 * 5. ~/ComfyUI
 * 6. ~/Documents/ComfyUI
 *
 * In each place, main.py directly or in a subfolder ComfyUI (portable layout).
 */
import { posix, win32 } from 'node:path';

export interface LocateOptions {
  platform: NodeJS.Platform;
  home: string;
  /** %LOCALAPPDATA% on Windows. */
  localAppData?: string;
  installPath?: string;
  pythonCommand?: string;
  exists(path: string): boolean;
}

export interface ComfyInstallation {
  /** The place that was found. */
  root: string;
  /** Folder holding main.py; the working directory of the process. */
  workDir: string;
  mainPy: string;
  python: string;
  /** Arguments before main.py, e.g. -s for the portable Python. */
  pythonArgs: string[];
  portable: boolean;
}

export type LocateResult =
  | { found: true; installation: ComfyInstallation; searched: string[] }
  | { found: false; searched: string[]; problem: string };

function pathsFor(platform: NodeJS.Platform) {
  return platform === 'win32' ? win32 : posix;
}

/** The application data folder of the server. */
export function applicationDataDir(options: LocateOptions): string {
  const path = pathsFor(options.platform);
  if (options.platform === 'win32') {
    const base = options.localAppData ?? path.join(options.home, 'AppData', 'Local');
    return path.join(base, 'FoundryMCPServer');
  }
  if (options.platform === 'darwin')
    return path.join(options.home, 'Library', 'Application Support', 'FoundryMCPServer');
  return path.join(options.home, '.local', 'share', 'FoundryMCPServer');
}

/** The places in search order. */
export function searchPlaces(options: LocateOptions): string[] {
  const path = pathsFor(options.platform);
  if (options.installPath) return [path.resolve(options.home, options.installPath)];
  const data = applicationDataDir(options);
  return [
    path.join(data, 'ComfyUI-headless'),
    path.join(data, 'ComfyUI'),
    '/Applications/FoundryMCPServer.app/Contents/Resources/ComfyUI',
    path.join(options.home, 'ComfyUI'),
    path.join(options.home, 'Documents', 'ComfyUI'),
  ];
}

function isPathLike(command: string): boolean {
  return /[\\/]/.test(command) || /\.exe$/i.test(command);
}

function choosePython(
  options: LocateOptions,
  root: string,
  workDir: string,
  portable: boolean
): { python: string; pythonArgs: string[] } | { problem: string } {
  const path = pathsFor(options.platform);
  const given = options.pythonCommand;
  if (given) {
    if (!isPathLike(given)) return { python: given, pythonArgs: [] };
    const resolved = path.isAbsolute(given) ? given : path.join(root, given);
    if (options.exists(resolved)) return { python: resolved, pythonArgs: portable ? ['-s'] : [] };
    return {
      problem: `COMFYUI_PYTHON_COMMAND="${given}" points to ${resolved}, which does not exist.`,
    };
  }

  const embedded = [path.join(root, 'python_embeded', 'python.exe')];
  for (const candidate of embedded) {
    if (options.exists(candidate)) return { python: candidate, pythonArgs: ['-s'] };
  }
  const environments = [
    path.join(workDir, '.venv', 'bin', 'python'),
    path.join(workDir, 'venv', 'bin', 'python'),
    path.join(workDir, '.venv', 'Scripts', 'python.exe'),
    path.join(workDir, 'venv', 'Scripts', 'python.exe'),
  ];
  for (const candidate of environments) {
    if (options.exists(candidate)) return { python: candidate, pythonArgs: [] };
  }
  return { python: options.platform === 'win32' ? 'python' : 'python3', pythonArgs: [] };
}

export function locateComfyUI(options: LocateOptions): LocateResult {
  const path = pathsFor(options.platform);
  const searched: string[] = [];
  for (const root of searchPlaces(options)) {
    for (const [workDir, portable] of [
      [root, false],
      [path.join(root, 'ComfyUI'), true],
    ] as const) {
      const mainPy = path.join(workDir, 'main.py');
      searched.push(mainPy);
      if (!options.exists(mainPy)) continue;
      const python = choosePython(options, root, workDir, portable);
      if ('problem' in python) return { found: false, searched, problem: python.problem };
      return {
        found: true,
        searched,
        installation: { root, workDir, mainPy, portable, ...python },
      };
    }
  }
  const where = options.installPath
    ? `COMFYUI_INSTALL_PATH="${options.installPath}" holds no main.py`
    : 'no ComfyUI installation was found';
  return {
    found: false,
    searched,
    problem: `ComfyUI installation not found: ${where}. Searched: ${searched.join(', ')}. Set COMFYUI_INSTALL_PATH to the folder that contains main.py.`,
  };
}
