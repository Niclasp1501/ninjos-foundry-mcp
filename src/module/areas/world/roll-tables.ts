/**
 * Roll tables: list them, create one from text entries, delete one.
 *
 * Drawing from a table and changing an existing one belong to the chat-tables-macros area.
 */
import { MODULE_ID } from '../../../common/constants.js';
import type { QueryHandler } from '../../dispatcher.js';
import { QueryError } from '../../dispatcher.js';
import { ensureFolderPath, type EnsuredFolderPath } from '../../folders.js';
import { requireWorld } from '../../world-ready.js';
import { idOf, inputOf, notFoundById, textOf } from './lookup.js';
import { PlanError, planRollTable } from './ranges.js';

const tables = () => game.tables as FoundryCollection<FoundryWorldRollTable>;

function folderName(folder: unknown): string | null {
  const id = idOf(folder);
  return id ? (game.folders.get(id)?.name ?? null) : null;
}

function rollTableClass(): { create(data: Record<string, unknown>): Promise<unknown> } {
  const found = (globalThis as Record<string, unknown>)['RollTable'];
  const create = (found as { create?: unknown } | undefined)?.create;
  if (typeof create !== 'function')
    throw new QueryError('NO_FOUNDRY', "Foundry's RollTable class is not available");
  return found as { create(data: Record<string, unknown>): Promise<unknown> };
}

/**
 * The core helper marks created folders with `createdByMcp`. The previous
 * generation marked them with `mcpGenerated` and `createdAt`, and a later
 * cleanup has to find the folders of both. So every created folder gets the old marker too, and is
 * read back. A folder that keeps only the new marker is not a reason to fail
 * the table, which is created next; it is reported as a warning instead.
 */
async function addPreviousMarkers(
  created: EnsuredFolderPath['created'],
  warnings: string[]
): Promise<void> {
  for (const entry of created) {
    const folder = game.folders.get(entry.id);
    const createdAt = new Date().toISOString();
    try {
      await folder?.update({ flags: { [MODULE_ID]: { mcpGenerated: true, createdAt } } });
    } catch {
      // Checked below by reading back.
    }
    const flags = (game.folders.get(entry.id) as { flags?: unknown } | undefined)?.flags;
    const own = (flags as Record<string, Record<string, unknown> | undefined> | undefined)?.[
      MODULE_ID
    ];
    if (own?.['mcpGenerated'] !== true || typeof own['createdAt'] !== 'string') {
      warnings.push(
        `Folder "${entry.path}" (id ${entry.id}) was created, but the marker "mcpGenerated" could not be added; ` +
          'it only carries "createdByMcp".'
      );
    }
  }
}

export const listRollTables: QueryHandler = {
  access: { kind: 'read' },
  run: () => {
    requireWorld();
    return {
      tables: tables().map(table => ({
        id: table.id,
        name: table.name,
        formula: typeof table.formula === 'string' ? table.formula : '',
        folder: folderName(table.folder),
        resultCount: table.results.size,
      })),
    };
  },
};

export const createRollTable: QueryHandler = {
  access: { kind: 'write', document: 'RollTables', action: 'create' },
  run: async (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const name = textOf(input['name']);
    if (!name) throw new QueryError('INVALID_ARGUMENTS', 'name is required');

    // Everything is checked before the first write, so a bad entry leaves no folder behind.
    let plan;
    try {
      plan = planRollTable({ results: input['results'], formula: input['formula'] });
    } catch (error) {
      if (error instanceof PlanError) throw new QueryError('INVALID_ARGUMENTS', error.message);
      throw error;
    }
    const RollTable = rollTableClass();

    const folder = await ensureFolderPath(textOf(input['folderPath']), {
      type: 'RollTable',
      context,
      query: 'createRollTable',
      tool: 'create-roll-table',
    });
    const warnings = [...plan.warnings];
    await addPreviousMarkers(folder.created, warnings);
    const createdPaths = folder.created.map(entry => entry.path);

    const source: Record<string, unknown> = {
      name,
      formula: plan.formula,
      // Drawn results go back into the table, and the roll shows in the chat.
      replacement: true,
      displayRoll: true,
      folder: folder.id,
      results: plan.results.map((result, index) => ({
        type: 'text',
        // Foundry 13 and later keep the text in `description`; Foundry 12 and
        // the previous generation module use `text`. Both get the same text,
        // each version drops the field it does not know.
        // OPEN: not checked in a browser against v14.
        description: result.text,
        text: result.text,
        range: result.range,
        weight: result.weight,
        drawn: false,
        sort: (index + 1) * 100,
      })),
    };
    const description = textOf(input['description']);
    if (description) source['description'] = description;

    const createdNote = createdPaths.length
      ? ` Folders created before the failure: ${createdPaths.join(', ')}.`
      : '';
    let made: unknown;
    try {
      made = await RollTable.create(source);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new QueryError('CREATE_FAILED', `${message}${createdNote}`);
    }

    const id = idOf(made);
    const table = id ? tables().get(id) : undefined;
    if (!table) {
      throw new QueryError(
        'NOT_APPLIED',
        `Foundry did not report a new roll table "${name}", and none is in the world when read back.${createdNote}`
      );
    }
    if (table.results.size !== plan.results.length) {
      throw new QueryError(
        'NOT_APPLIED',
        `Roll table "${name}" (id ${table.id}) was created with ${table.results.size} of ${plan.results.length} ` +
          'entries. Check it in Foundry before relying on it.'
      );
    }

    context.recordChange({
      query: 'createRollTable',
      tool: 'create-roll-table',
      document: 'RollTables',
      action: 'create',
      targets: [{ id: table.id, uuid: table.uuid, name }],
      summary: `Created roll table "${name}" (${plan.formula}, ${plan.results.length} entries).`,
      after: table.toObject(),
    });

    const formula = typeof table.formula === 'string' ? table.formula : plan.formula;
    return {
      id: table.id,
      name: table.name,
      formula,
      formulaDerived: plan.formulaDerived,
      entries: table.results.size,
      // The field a previous generation server reads for the count.
      resultCount: table.results.size,
      folderId: folder.id,
      folderPath: folder.path || null,
      foldersCreated: createdPaths,
      warnings,
    };
  },
};

export const deleteRollTable: QueryHandler = {
  access: { kind: 'write', document: 'RollTables', action: 'delete' },
  run: async (data, context) => {
    requireWorld();
    const id = textOf(inputOf(data)['tableId']);
    if (!id) throw new QueryError('INVALID_ARGUMENTS', 'tableId is required');

    const table = tables().get(id);
    if (!table) throw notFoundById(game.tables, id, 'Roll table');

    const before = table.toObject();
    await table.delete();
    if (tables().get(id)) {
      throw new QueryError(
        'NOT_APPLIED',
        `Roll table "${table.name}" was deleted, but it is still in the world when read back.`
      );
    }

    context.recordChange({
      query: 'deleteRollTable',
      tool: 'delete-roll-table',
      document: 'RollTables',
      action: 'delete',
      targets: [{ id, uuid: table.uuid, name: table.name }],
      summary: `Deleted roll table "${table.name}".`,
      before,
    });
    return { id, name: table.name, deleted: true };
  },
};
