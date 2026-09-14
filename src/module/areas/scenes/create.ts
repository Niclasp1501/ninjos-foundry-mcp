/**
 * CreateScene and restoreScene, the two queries that bring a
 * new scene into the world.
 */
import {
  derivedNavName,
  encodeMediaPath,
  readableName,
} from '../../../common/areas/scenes/names.js';
import type { HandlerContext, QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import { ensureFolderPath, type EnsuredFolder } from './folders.js';
import { levelSettingsOf, patchLevel } from './level.js';
import { journalLink } from './links.js';
import { measureMedia, renewThumbnail, thumbnailReport } from './media.js';
import {
  booleanArg,
  dataOf,
  documentClass,
  fail,
  findScene,
  firstCreated,
  idOf,
  isRecord,
  messageOf,
  numberArg,
  operation,
  route,
  sizeOf,
  textArg,
} from './support.js';
import { activateScene } from './view.js';

export const DEFAULT_SIZE = { width: 4000, height: 3000 };
export const DEFAULT_GRID_SIZE = 100;

/**
 * Everything a template must not pass on: its identity, metadata, thumbnail,
 * active state, and everything that lies on its map. Levels go too; their
 * settings are carried over separately onto the new scene's own level.
 */
const NOT_FROM_TEMPLATE = [
  '_id',
  '_stats',
  'thumb',
  'active',
  'tokens',
  'drawings',
  'lights',
  'notes',
  'sounds',
  'tiles',
  'walls',
  'templates',
  'regions',
  'levels',
  'initialLevel',
  'journal',
  'journalEntryPage',
  'folder',
  'sort',
] as const;

function templateData(template: FoundryScenesScene): Record<string, unknown> {
  const data = template.toObject();
  for (const key of NOT_FROM_TEMPLATE) delete data[key];
  return data;
}

function record(
  context: HandlerContext,
  query: string,
  tool: string,
  folder: EnsuredFolder | undefined
): void {
  for (const created of folder?.created ?? []) {
    context.recordChange({
      query,
      tool,
      document: 'Folders',
      action: 'create',
      targets: [{ id: created.id, name: created.name }],
      summary: `Created the scene folder "${created.name}" for a scene.`,
    });
  }
}

function sceneInWorld(id: string): FoundryScenesScene {
  const scene = game.scenes.get(id) as FoundryScenesScene | undefined;
  if (!scene)
    fail('NOT_CREATED', 'Foundry reported the scene as created, but it is not in the world');
  return scene;
}

function foundryGeneration(): number {
  return Number.parseInt(String(game.version).split('.')[0] ?? '', 10) || 0;
}

export const createScene: QueryHandler = {
  access: { kind: 'write', document: 'Scenes', action: 'create' },
  run: (raw, context) =>
    operation('create scene', async () => {
      requireWorld();
      const data = dataOf(raw);
      const name = textArg(data, 'name') ?? fail('INVALID_ARGUMENT', 'name is required');
      const givenBackground =
        textArg(data, 'background') ?? fail('INVALID_ARGUMENT', 'background is required');
      const background = encodeMediaPath(givenBackground);
      const width = numberArg(data, 'width');
      const height = numberArg(data, 'height');
      const padding = numberArg(data, 'padding');
      const gridSize = numberArg(data, 'gridSize');
      const navigation = booleanArg(data, 'navigation');
      const activate = booleanArg(data, 'activate') === true;
      const warnings: string[] = [];

      // Every lookup before the first write, so a typo leaves nothing behind.
      const templateIdentifier = textArg(data, 'templateName');
      const template = templateIdentifier ? findScene(templateIdentifier, 'template') : undefined;
      const journalIdentifier =
        typeof data['journalIdentifier'] === 'string' ? data['journalIdentifier'] : undefined;
      const link = journalLink(journalIdentifier, textArg(data, 'journalPageName'));

      let measured = false;
      let chosen = { width, height };
      if (width === undefined || height === undefined) {
        const measurement = await measureMedia(background);
        if ('width' in measurement) {
          measured = true;
          chosen = { width: width ?? measurement.width, height: height ?? measurement.height };
        } else {
          warnings.push(
            `The file could not be measured (${measurement.failed}); the size comes from ${template ? 'the template' : 'the default'}.`
          );
        }
      }

      const folderPathArg = typeof data['folderPath'] === 'string' ? data['folderPath'] : undefined;
      const folder =
        folderPathArg !== undefined ? await ensureFolderPath(folderPathArg) : undefined;
      record(context, 'createScene', 'create-scene', folder);

      const base = template ? templateData(template) : {};
      const grid = isRecord(base['grid']) ? base['grid'] : {};
      const backgroundBase = isRecord(base['background']) ? base['background'] : {};
      const createData: Record<string, unknown> = {
        ...base,
        name: readableName(name),
        navName: textArg(data, 'navName') ?? derivedNavName(name),
        width: chosen.width ?? template?.width ?? DEFAULT_SIZE.width,
        height: chosen.height ?? template?.height ?? DEFAULT_SIZE.height,
        padding: padding ?? template?.padding ?? 0,
        grid: { ...grid, size: gridSize ?? template?.grid?.size ?? DEFAULT_GRID_SIZE },
        navigation: navigation ?? false,
        background: { ...backgroundBase, src: background },
        folder: folder?.id ?? null,
        journal: link?.journal ?? null,
        journalEntryPage: link?.journalEntryPage ?? null,
        active: false,
      };

      const created = firstCreated(await documentClass('Scene').create(createData), 'scene');
      const scene = sceneInWorld(created.id);
      context.recordChange({
        query: 'createScene',
        tool: 'create-scene',
        document: 'Scenes',
        action: 'create',
        targets: [{ id: scene.id, uuid: scene.uuid, name: scene.name }],
        summary: `Created the scene "${scene.name}".`,
      });

      const levelSettings = template ? levelSettingsOf(template) : undefined;
      const level = await patchLevel(scene, {
        src: background,
        ...(levelSettings ? { settings: levelSettings } : {}),
      });
      if (
        !level.levelPatched &&
        level.reason &&
        level.reason !== 'this Foundry version has no scene levels'
      )
        warnings.push(
          `The level was not changed, so the background may not show on the map: ${level.reason}.`
        );

      const thumbnail = thumbnailReport(await renewThumbnail(scene));
      if (!thumbnail.updated) warnings.push(`No thumbnail: ${thumbnail.reason}.`);

      let activated: boolean | undefined;
      if (activate) {
        const outcome = await activateScene(scene);
        activated = outcome.active;
        if (!outcome.active)
          warnings.push(`The scene was created but not activated: ${outcome.reason}.`);
      }

      // `probed`, `template`, `folder` and `journal` are what a server of the previous
      // generation reads and puts into its text, so they are plain texts; the ids stand beside them.
      const journalReport = link?.report ?? null;
      return {
        id: scene.id,
        name: scene.name,
        navName: scene.navName ?? null,
        width: scene.width,
        height: scene.height,
        measured,
        probed: measured,
        folder: idOf(scene.folder),
        folderId: idOf(scene.folder),
        foldersCreated: (folder?.created ?? []).map(entry => entry.name),
        template: template ? template.name : null,
        templateId: template ? template.id : null,
        levelPatched: level.levelPatched,
        journal: journalReport ? journalReport.name : null,
        journalId: journalReport ? journalReport.id : null,
        ...(journalReport?.pageId
          ? { journalPageId: journalReport.pageId, journalPageName: journalReport.pageName }
          : {}),
        thumbnail,
        ...(activated === undefined ? {} : { activated }),
        warnings,
      };
    }),
};

const KEPT_COLLECTIONS = ['walls', 'tiles', 'lights', 'sounds', 'tokens', 'levels'] as const;

/** Placeables whose elevation decides the height of a level added to an old backup. */
const ELEVATED = ['tiles', 'tokens', 'drawings', 'lights'] as const;

/**
 * Bottom: the smaller of 0 and the lowest elevation; top: the larger of 20 and
 * the highest, plus 1. Without any elevation the level keeps Foundry's height.
 */
export function addedLevelElevation(
  entry: Record<string, unknown>
): { bottom: number; top: number } | undefined {
  const values = ELEVATED.flatMap(key =>
    Array.isArray(entry[key]) ? (entry[key] as unknown[]) : []
  )
    .map(item => (isRecord(item) ? item['elevation'] : undefined))
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!values.length) return undefined;
  return { bottom: Math.min(0, ...values), top: Math.max(20, ...values) + 1 };
}

/** "0 = Hafen, 1 = Kerker", the documented listing of a backup's entries. */
function describeEntries(entries: unknown[]): string {
  return entries
    .map((entry, index) => {
      const name =
        isRecord(entry) && typeof entry['name'] === 'string' ? entry['name'] : '(no name)';
      return `${index} = ${name}`;
    })
    .join(', ');
}

async function readBackup(path: string): Promise<unknown> {
  const fetcher = (
    globalThis as {
      fetch?: (
        url: string
      ) => Promise<{ ok: boolean; status: number; statusText?: string; text(): Promise<string> }>;
    }
  ).fetch;
  if (typeof fetcher !== 'function') fail('FOUNDRY_API', 'this browser offers no fetch');
  function unreadable(cause: string): never {
    fail(
      'FILE_NOT_READABLE',
      `"${path}" could not be read: ${cause}. The path counts from the Foundry data directory, for example "Bergung/szenen.json".`
    );
  }
  let response;
  try {
    response = await fetcher(route(encodeMediaPath(path)));
  } catch (error) {
    unreadable(messageOf(error));
  }
  if (!response.ok)
    unreadable(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch (error) {
    fail('INVALID_FILE', `"${path}" is not valid JSON: ${messageOf(error)}`);
  }
}

function chooseEntry(content: unknown, index: number | undefined): Record<string, unknown> {
  if (!Array.isArray(content)) {
    if (!isRecord(content))
      fail('INVALID_FILE', 'the file holds neither a scene nor a list of scenes');
    return content;
  }
  if (!content.length) fail('INVALID_FILE', 'the file holds an empty list');
  // Stricter than the previous generation, which took entry 0 without a word (decision 21).
  if (index === undefined && content.length > 1)
    fail(
      'INDEX_REQUIRED',
      `No index given. The file contains ${content.length}: ${describeEntries(content)}`
    );
  const chosen = index ?? 0;
  const entry = Number.isInteger(chosen) ? content[chosen] : undefined;
  if (entry === undefined)
    fail(
      'INDEX_OUT_OF_RANGE',
      `No entry ${chosen} in the file. It contains ${content.length}: ${describeEntries(content)}`
    );
  if (!isRecord(entry)) fail('INVALID_FILE', `entry ${chosen} is not a scene`);
  return entry;
}

export const restoreScene: QueryHandler = {
  access: { kind: 'write', document: 'Scenes', action: 'create' },
  run: (raw, context) =>
    operation('restore scene', async () => {
      requireWorld();
      const data = dataOf(raw);
      const path = textArg(data, 'jsonPath') ?? fail('INVALID_ARGUMENT', 'jsonPath is required');
      const index = numberArg(data, 'index');
      const newName = textArg(data, 'name');
      const keepId = booleanArg(data, 'keepId') === true;
      const navigation = booleanArg(data, 'navigation');
      const warnings: string[] = [];

      context.progress({ progress: 0, total: 3, message: `Reading ${path}` });
      const entry = structuredClone(chooseEntry(await readBackup(path), index));
      if (typeof entry['name'] !== 'string' || !entry['name'])
        fail('INVALID_FILE', 'the chosen entry has no scene name');

      const originalId = typeof entry['_id'] === 'string' ? entry['_id'] : undefined;
      if (keepId) {
        if (!originalId) fail('INVALID_FILE', 'keepId was set, but the entry has no id');
        const existing = game.scenes.get(originalId);
        if (existing)
          fail(
            'ID_TAKEN',
            `a scene with the id ${originalId} already exists ("${existing.name ?? ''}"); restoring with keepId would overwrite it`
          );
      } else {
        delete entry['_id'];
      }
      delete entry['_stats'];
      delete entry['thumb'];
      entry['active'] = false;

      if (newName) {
        entry['name'] = readableName(newName);
        entry['navName'] = derivedNavName(newName);
      }
      if (navigation !== undefined) entry['navigation'] = navigation;

      const folderPathArg = typeof data['folderPath'] === 'string' ? data['folderPath'] : undefined;
      let folder: EnsuredFolder | undefined;
      if (folderPathArg !== undefined) {
        folder = await ensureFolderPath(folderPathArg);
        entry['folder'] = folder.id;
      } else {
        const stored = idOf(entry['folder']);
        if (stored && !game.folders.get(stored)) {
          warnings.push(
            `The folder ${stored} of the backup does not exist in this world; the scene has no folder.`
          );
          entry['folder'] = null;
        }
      }
      record(context, 'restoreScene', 'restore-scene', folder);

      const expected = Object.fromEntries(
        KEPT_COLLECTIONS.map(key => [
          key,
          Array.isArray(entry[key]) ? (entry[key] as unknown[]).length : 0,
        ])
      ) as Record<(typeof KEPT_COLLECTIONS)[number], number>;

      let levelAdded = false;
      if (expected.levels === 0 && foundryGeneration() >= 14) {
        const oldBackground = isRecord(entry['background']) ? entry['background'] : {};
        const elevation = addedLevelElevation(entry);
        entry['levels'] = [
          {
            name: String(entry['name']),
            background: {
              ...(typeof oldBackground['src'] === 'string' ? { src: oldBackground['src'] } : {}),
              ...(typeof entry['backgroundColor'] === 'string'
                ? { color: entry['backgroundColor'] }
                : {}),
            },
            ...(elevation ? { elevation } : {}),
          },
        ];
        delete entry['initialLevel'];
        levelAdded = true;
      }

      context.progress({
        progress: 1,
        total: 3,
        message: `Creating the scene "${String(entry['name'])}"`,
      });
      const created = firstCreated(
        await documentClass('Scene').create(entry, keepId ? { keepId: true } : {}),
        'scene'
      );
      const scene = sceneInWorld(created.id);
      if (keepId && scene.id !== originalId)
        warnings.push(`Foundry gave the scene the id ${scene.id} instead of ${originalId ?? ''}.`);
      context.recordChange({
        query: 'restoreScene',
        tool: 'restore-scene',
        document: 'Scenes',
        action: 'create',
        targets: [{ id: scene.id, uuid: scene.uuid, name: scene.name }],
        summary: `Restored the scene "${scene.name}" from ${path}.`,
      });

      const kept = {
        walls: sizeOf(scene.walls),
        tiles: sizeOf(scene.tiles),
        lights: sizeOf(scene.lights),
        sounds: sizeOf(scene.sounds),
        tokens: sizeOf(scene.tokens),
        levels: sizeOf(scene.levels),
      };
      for (const key of KEPT_COLLECTIONS) {
        const wanted = key === 'levels' && levelAdded ? 1 : expected[key];
        if (kept[key] < wanted) warnings.push(`Only ${kept[key]} of ${wanted} ${key} came along.`);
      }

      context.progress({ progress: 2, total: 3, message: 'Creating the thumbnail' });
      const thumbnail = thumbnailReport(await renewThumbnail(scene));
      if (!thumbnail.updated) warnings.push(`No thumbnail: ${thumbnail.reason}.`);

      const contains =
        KEPT_COLLECTIONS.map(key => `${kept[key]} ${key}`).join(', ') +
        (levelAdded ? ' (the backup had no level; one was added)' : '');
      return {
        id: scene.id,
        name: scene.name,
        // width, height and contains are what a server of the previous generation reads.
        width: scene.width,
        height: scene.height,
        contains,
        folderId: idOf(scene.folder),
        foldersCreated: (folder?.created ?? []).map(item => item.name),
        kept,
        levelAdded,
        thumbnail,
        warnings,
      };
    }),
};
