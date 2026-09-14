/**
 * createNpcActor: dnd5e-create-npc in the module.
 *
 * Checked before anything is written: the system, every argument, and that
 * no actor carries the name already (ignoring case, like every name rule of
 * this package; a second "goblin" would make every later lookup by name
 * ambiguous). Then the folder, the actor, and a read back of every value.
 */
import { buildNpcData, describeNpc } from '../../../common/areas/dnd5e/npc-data.js';
import { formatCr, isRecord } from '../../../common/areas/dnd5e/rules.js';
import { QueryError, type QueryHandler } from '../../dispatcher.js';
import { documentClass, mismatches } from '../actors/common.js';
import { CREATURE_FOLDER, resolveFolder } from '../actors/folders.js';
import {
  actorsOf,
  callData,
  describeDocuments,
  invalid,
  languageTable,
  requireDnd5e,
  sameNamedActors,
  worldRules,
} from './common.js';

const TOOL = 'dnd5e-create-npc';

export const createNpcActor: QueryHandler = {
  access: { kind: 'write', document: 'Actors', action: 'create' },
  run: async (data, context) => {
    const system = requireDnd5e(TOOL);
    const input = callData(data);
    const build = buildNpcData(input, {
      systemVersion: system.version,
      languages: languageTable(),
      worldRules: worldRules(),
    });
    if (build.problems.length) throw invalid('Cannot create the NPC', build.problems);

    const name = String(build.data['name']);
    const twins = sameNamedActors(name);
    if (twins.length) {
      throw new QueryError(
        'ALREADY_EXISTS',
        `An actor named "${name}" exists already: ${describeDocuments(twins)}. Nothing was created. ` +
          'Choose another name, or add features to the existing one with dnd5e-add-feature.'
      );
    }

    const folder = await resolveFolder(CREATURE_FOLDER, 'Actor', {
      context,
      query: 'createNpcActor',
      tool: TOOL,
    });
    const created = (await documentClass('Actor').create({ ...build.data, folder: folder.id })) as
      FoundryActorsActor | undefined;
    const actor = created ? actorsOf().get(created.id) : undefined;
    if (!actor) {
      throw new QueryError(
        'NOT_CREATED',
        `Foundry did not create the NPC "${name}": no actor came back. Folders created on the way: ${folder.created.length}.`
      );
    }

    const stored = actor.toObject();
    const written = isRecord(build.data['system']) ? build.data['system'] : {};
    const differences = mismatches(written, isRecord(stored['system']) ? stored['system'] : {}).map(
      entry => ({
        ...entry,
        path: `system.${entry.path}`,
      })
    );
    context.recordChange({
      query: 'createNpcActor',
      tool: TOOL,
      document: 'Actors',
      action: 'create',
      targets: [{ id: actor.id, uuid: actor.uuid, name: actor.name, documentName: 'Actor' }],
      summary: `Created the NPC "${actor.name}" (CR ${formatCr(build.cr)}) in folder "${folder.path}".`,
      after: stored,
    });

    return {
      success: true,
      summary: `NPC "${actor.name}" created (CR ${formatCr(build.cr)}) in folder "${folder.path}".`,
      actor: {
        id: actor.id,
        name: actor.name,
        cr: build.cr,
        crText: formatCr(build.cr),
        folder: folder.path,
        folderId: folder.id,
      },
      createdFolders: folder.created,
      stats: describeNpc(input, build.cr),
      warnings: build.warnings,
      mismatches: differences,
      notWritten:
        'Proficiency bonus and experience points are derived by dnd5e from the challenge rating and were not written.',
    };
  },
};
