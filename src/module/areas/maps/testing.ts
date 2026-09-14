/**
 * What the maps area needs beyond the default fake: the scene helpers of
 * the scenes area (activate, thumbnail, canvas) and Foundry's FilePicker with a
 * data directory in memory.
 */
import type { FakeFoundry } from '../../../testing/fake-foundry.js';
import { withScenes, type ScenesFakeOptions } from '../scenes/testing.js';

export interface MapsFakeOptions extends ScenesFakeOptions {
  /** Make every upload fail with this message. */
  uploadFails?: string;
  /** Pretend the upload worked but store nothing. */
  uploadLoses?: boolean;
}

export interface FakeFilePicker extends FoundryMapsFilePicker {
  readonly files: Map<string, { size: number; type: string }>;
  readonly directories: Set<string>;
  uploads: number;
}

export function withMaps(
  foundry: FakeFoundry,
  options: MapsFakeOptions = {}
): { foundry: FakeFoundry; picker: FakeFilePicker } {
  withScenes(foundry, options);
  const files = new Map<string, { size: number; type: string }>();
  const directories = new Set<string>(['worlds', `worlds/${String(foundry.game.world?.id)}`]);
  const picker: FakeFilePicker = {
    files,
    directories,
    uploads: 0,
    async browse(_source, target) {
      if (!directories.has(target)) throw new Error(`Directory ${target} does not exist`);
      const inside = [...files.keys()].filter(
        path => path.slice(0, path.lastIndexOf('/')) === target
      );
      return { target, files: inside.map(path => encodeURI(path)), dirs: [] };
    },
    async createDirectory(_source, target) {
      if (directories.has(target)) throw new Error(`EEXIST: ${target}`);
      directories.add(target);
      return { target };
    },
    async upload(_source, path, file) {
      picker.uploads += 1;
      if (options.uploadFails) return { status: 'error', message: options.uploadFails };
      if (!directories.has(path)) throw new Error(`Directory ${path} does not exist`);
      const stored = `${path}/${file.name}`;
      if (!options.uploadLoses) files.set(stored, { size: file.size, type: file.type });
      return { status: 'success', path: stored, message: 'uploaded' };
    },
  };
  foundry.setGlobal('foundry', {
    applications: { apps: { FilePicker: { implementation: picker } } },
  });
  return { foundry, picker };
}
