/**
 * The queries that change an existing scene. updateScene,
 * createSceneNote, refreshSceneThumb and switch-scene.
 *
 * Switching the active scene counts as changing scenes: every player sees
 * it, so it goes through the write switch and the matrix like any change.
 */
import {
  decodeMediaPath,
  derivedNavName,
  encodeMediaPath,
  readableName,
} from '../../../common/areas/scenes/names.js';
import { afterWriteWarning, errorText, settleWrite } from '../../client-errors.js';
import type { QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import { ensureFolderPath } from './folders.js';
import { hasLevels, patchLevel } from './level.js';
import { journalLink } from './links.js';
import { measureMedia, renewThumbnail } from './media.js';
import {
  booleanArg,
  dataOf,
  fail,
  findScene,
  idOf,
  isRecord,
  numberArg,
  operation,
  textArg,
} from './support.js';
import { activateScene, optimizeView } from './view.js';

export const DEFAULT_NOTE_ICON = 'icons/svg/book.svg';
export const DEFAULT_NOTE_ICON_SIZE = 40;

const CHANGEABLE = [
  'name',
  'navName',
  'background',
  'backgroundColor',
  'width',
  'height',
  'folderPath',
  'navigation',
  'journalIdentifier',
  'journalPageName',
];

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export const updateScene: QueryHandler = {
  access: { kind: 'write', document: 'Scenes', action: 'update' },
  run: (raw, context) =>
    operation('update scene', async () => {
      requireWorld();
      const data = dataOf(raw);
      const identifier =
        textArg(data, 'sceneIdentifier') ?? fail('INVALID_ARGUMENT', 'sceneIdentifier is required');
      if (!CHANGEABLE.some(key => data[key] !== undefined))
        fail('NO_CHANGE', `no change given; pass at least one of ${CHANGEABLE.join(', ')}`);

      const scene = findScene(identifier);
      const warnings: string[] = [];
      const changes: Record<string, unknown> = {};
      const checks: Array<[string, () => boolean]> = [];

      const name = textArg(data, 'name');
      if (data['name'] !== undefined && !name) fail('INVALID_ARGUMENT', 'name must not be empty');
      const navName = textArg(data, 'navName');
      if (name) {
        const readable = readableName(name);
        changes['name'] = readable;
        checks.push(['name', () => scene.name === readable]);
      }
      if (navName || name) {
        const label = navName ?? derivedNavName(name ?? '');
        changes['navName'] = label;
        checks.push(['navName', () => scene.navName === label]);
      }

      const width = numberArg(data, 'width');
      const height = numberArg(data, 'height');
      const givenBackground = textArg(data, 'background');
      if (data['background'] !== undefined && !givenBackground)
        fail('INVALID_ARGUMENT', 'background must not be empty');
      const background = givenBackground ? encodeMediaPath(givenBackground) : undefined;
      let measured = false;
      if (background) {
        changes['background.src'] = background;
        checks.push([
          'background',
          () =>
            decodeMediaPath(scene.background?.src ?? '') === decodeMediaPath(background) ||
            hasLevels(scene),
        ]);
        if (width === undefined || height === undefined) {
          const measurement = await measureMedia(background);
          if ('width' in measurement) {
            measured = true;
            if (width === undefined) changes['width'] = measurement.width;
            if (height === undefined) changes['height'] = measurement.height;
          } else {
            warnings.push(
              `The new background could not be measured (${measurement.failed}); the size stays as it was.`
            );
          }
        }
      }
      if (width !== undefined) changes['width'] = width;
      if (height !== undefined) changes['height'] = height;
      for (const key of ['width', 'height'] as const) {
        const value = changes[key];
        if (value !== undefined) checks.push([key, () => scene[key] === value]);
      }

      const color = textArg(data, 'backgroundColor');
      if (data['backgroundColor'] !== undefined) {
        if (!color || !HEX_COLOR.test(color))
          fail(
            'INVALID_ARGUMENT',
            `backgroundColor must be a hex colour like "#000000", got "${String(data['backgroundColor'])}"`
          );
        changes['backgroundColor'] = color;
      }

      const navigation = booleanArg(data, 'navigation');
      if (navigation !== undefined) {
        changes['navigation'] = navigation;
        checks.push(['navigation', () => scene.navigation === navigation]);
      }

      const journalIdentifier =
        typeof data['journalIdentifier'] === 'string' ? data['journalIdentifier'] : undefined;
      const link = journalLink(
        journalIdentifier,
        textArg(data, 'journalPageName'),
        idOf(scene.journal)
      );
      if (link) {
        changes['journal'] = link.journal;
        changes['journalEntryPage'] = link.journalEntryPage;
        checks.push([
          'journal',
          () =>
            idOf(scene.journal) === link.journal &&
            (scene.journalEntryPage ?? null) === link.journalEntryPage,
        ]);
      }

      // Lookups are done; only now may a folder be created.
      const folderPathArg = typeof data['folderPath'] === 'string' ? data['folderPath'] : undefined;
      const folder =
        folderPathArg !== undefined ? await ensureFolderPath(folderPathArg) : undefined;
      for (const created of folder?.created ?? []) {
        context.recordChange({
          query: 'updateScene',
          tool: 'update-scene',
          document: 'Folders',
          action: 'create',
          targets: [{ id: created.id, name: created.name }],
          summary: `Created the scene folder "${created.name}" for a scene.`,
        });
      }
      if (folder) {
        changes['folder'] = folder.id;
        checks.push(['folder', () => idOf(scene.folder) === folder.id]);
      }

      const before = scene.toObject();
      const previous: Record<string, unknown> = {};
      for (const key of Object.keys(changes)) {
        const top = key.split('.')[0] ?? key;
        previous[top] = before[top] === undefined ? null : structuredClone(before[top]);
      }

      await scene.update(changes);
      context.recordChange({
        query: 'updateScene',
        tool: 'update-scene',
        document: 'Scenes',
        action: 'update',
        targets: [{ id: scene.id, uuid: scene.uuid, name: scene.name }],
        summary: `Changed ${Object.keys(changes).join(', ')} of the scene "${scene.name}".`,
        before: previous,
      });

      let levelPatched: boolean | undefined;
      if (background || color) {
        const outcome = await patchLevel(scene, {
          ...(background ? { src: background } : {}),
          ...(color ? { color } : {}),
        });
        levelPatched = outcome.levelPatched;
        if (!outcome.levelPatched && hasLevels(scene))
          fail(
            'NOT_APPLIED',
            `the scene was updated, but its level was not, so the map does not show the change: ${outcome.reason ?? 'unknown cause'}`
          );
      }

      const failed = checks.filter(([, check]) => !check()).map(([field]) => field);
      if (failed.length)
        fail(
          'NOT_APPLIED',
          `the scene was updated, but these changes did not take effect: ${failed.join(', ')}`
        );

      const changed = checks.map(([field]) => field);
      if (color) changed.push('backgroundColor');
      return {
        id: scene.id,
        name: scene.name,
        changed: [...new Set(changed)],
        measured,
        ...(levelPatched === undefined ? {} : { levelPatched }),
        foldersCreated: (folder?.created ?? []).map(entry => entry.name),
        journal: link?.report ?? undefined,
        warnings,
      };
    }),
};

export const createSceneNote: QueryHandler = {
  access: { kind: 'write', document: 'Scenes', action: 'update' },
  run: (raw, context) =>
    operation('create scene note', async () => {
      requireWorld();
      const data = dataOf(raw);
      const sceneIdentifier =
        textArg(data, 'sceneIdentifier') ?? fail('INVALID_ARGUMENT', 'sceneIdentifier is required');
      const journalIdentifier =
        textArg(data, 'journalName') ?? fail('INVALID_ARGUMENT', 'journalName is required');
      const x = numberArg(data, 'x');
      const y = numberArg(data, 'y');
      if (x === undefined || y === undefined) fail('INVALID_ARGUMENT', 'x and y are required');
      const iconSize = numberArg(data, 'iconSize') ?? DEFAULT_NOTE_ICON_SIZE;
      if (iconSize <= 0) fail('INVALID_ARGUMENT', 'iconSize must be greater than 0');

      const scene = findScene(sceneIdentifier);
      const link = journalLink(journalIdentifier, textArg(data, 'pageName'));
      if (!link?.report) fail('JOURNAL_NOT_FOUND', `journal not found: "${journalIdentifier}"`);
      const label = textArg(data, 'label');
      const icon = textArg(data, 'icon');

      const notesBefore = new Set(scene.notes?.map(entry => entry.id) ?? []);
      // Foundry's client code for notes can throw after the server created one (no canvas): read back.
      const attempt = await settleWrite(() =>
        scene.createEmbeddedDocuments('Note', [
          {
            entryId: link.journal,
            pageId: link.journalEntryPage,
            x,
            y,
            text: label ?? '',
            texture: { src: icon ? encodeMediaPath(icon) : DEFAULT_NOTE_ICON },
            iconSize,
          },
        ])
      );
      const note = Array.isArray(attempt.value) ? attempt.value[0] : undefined;
      const stored = note
        ? scene.notes?.get(note.id)
        : attempt.threw
          ? scene.notes?.find(entry => !notesBefore.has(entry.id) && entry.entryId === link.journal)
          : undefined;
      if (!stored || stored.entryId !== link.journal)
        fail(
          'NOT_CREATED',
          attempt.threw
            ? `Foundry refused the note: ${errorText(attempt.error)}`
            : 'Foundry did not keep the note on the scene'
        );

      context.recordChange({
        query: 'createSceneNote',
        tool: 'create-scene-note',
        document: 'Scenes',
        action: 'create',
        targets: [{ id: stored.id, uuid: stored.uuid, name: link.report.name }],
        summary: `Placed a note for "${link.report.name}" on the scene "${scene.name}".`,
      });

      const warnings: string[] = [];
      if (attempt.threw)
        warnings.push(afterWriteWarning(attempt.error, 'Read back, the note is on the scene.'));
      const padding = scene.padding ?? 0;
      const limitX = scene.width * (1 + 2 * padding);
      const limitY = scene.height * (1 + 2 * padding);
      if (x < 0 || y < 0 || x > limitX || y > limitY)
        warnings.push(
          `The position ${x}/${y} lies outside the scene (${Math.round(limitX)} x ${Math.round(limitY)} with padding).`
        );

      // scene, journal, x and y are what a server of the previous generation puts into its text.
      return {
        scene: scene.name,
        journal: link.report.name,
        x,
        y,
        id: stored.id,
        sceneId: scene.id,
        sceneName: scene.name,
        noteId: stored.id,
        journalId: link.report.id,
        ...(link.report.pageId
          ? { pageId: link.report.pageId, pageName: link.report.pageName }
          : {}),
        warnings,
      };
    }),
};

export const refreshSceneThumb: QueryHandler = {
  access: { kind: 'write', document: 'Scenes', action: 'update' },
  run: (raw, context) =>
    operation('refresh scene thumbnail', async () => {
      requireWorld();
      const data = dataOf(raw);
      const identifier =
        textArg(data, 'sceneIdentifier') ?? fail('INVALID_ARGUMENT', 'sceneIdentifier is required');
      const scene = findScene(identifier);
      const before = scene.thumb ?? null;
      const outcome = await renewThumbnail(scene);
      if (!outcome.updated) {
        if (outcome.threw) fail('THUMBNAIL_FAILED', `Thumbnail failed: ${outcome.reason}`);
        fail(
          'THUMBNAIL_FAILED',
          `Thumbnail of "${scene.name}" could not be generated: ${outcome.reason}`
        );
      }
      context.recordChange({
        query: 'refreshSceneThumb',
        tool: 'refresh-scene-thumb',
        document: 'Scenes',
        action: 'update',
        targets: [{ id: scene.id, uuid: scene.uuid, name: scene.name }],
        summary: `Renewed the thumbnail of the scene "${scene.name}".`,
        before: { thumb: before },
      });
      return { updated: true, scene: scene.name, sceneId: scene.id, sceneName: scene.name };
    }),
};

export const switchScene: QueryHandler = {
  access: { kind: 'write', document: 'Scenes', action: 'update' },
  run: (raw, context) =>
    operation('switch scene', async () => {
      requireWorld();
      const data = dataOf(raw);
      const identifier =
        textArg(data, 'scene_identifier') ??
        textArg(data, 'sceneId') ??
        fail('INVALID_ARGUMENT', 'scene_identifier is required');
      const optimize = booleanArg(data, 'optimize_view') ?? true;
      const scene = findScene(identifier);
      const previous = (game.scenes.contents as unknown[]).find(
        entry => isRecord(entry) && entry['active'] === true
      ) as FoundryScenesScene | undefined;

      const outcome = await activateScene(scene);
      if (!outcome.active)
        fail('NOT_APPLIED', `the scene "${scene.name}" was not activated: ${outcome.reason}`);
      context.recordChange({
        query: 'switch-scene',
        tool: 'switch-scene',
        document: 'Scenes',
        action: 'update',
        targets: [{ id: scene.id, uuid: scene.uuid, name: scene.name }],
        summary: `Activated the scene "${scene.name}" for everyone.`,
        before: { activeSceneId: previous?.id ?? null },
      });

      const view = optimize ? await optimizeView(scene) : undefined;
      return {
        success: true,
        // sceneId, sceneName and dimensions: the answer of the previous generation, passed on by its server.
        sceneId: scene.id,
        sceneName: scene.name,
        dimensions: { width: scene.width, height: scene.height },
        id: scene.id,
        name: scene.name,
        width: scene.width,
        height: scene.height,
        ...(view ? { viewOptimized: view.optimized } : {}),
        warnings:
          view && !view.optimized
            ? [`The view was not fitted: ${view.reason ?? 'unknown cause'}.`]
            : [],
      };
    }),
};
