/**
 * assign-actor-ownership, remove-actor-ownership and list-actor-ownership.
 *
 * The module resolves actors and players and applies every pair in one query
 * (changeActorOwnership). A module of the previous generation lacks it; for
 * it the server resolves with that module's queries, with the phrases matched
 * as whole phrases and partial player matches switched off.
 */
import {
  FRIENDLY_NPCS,
  PARTY,
  PARTY_CHARACTERS,
  levelNumber,
  phrase,
} from '../../../common/areas/actors/ownership.js';
import { messageOf } from '../../tools/results.js';
import {
  readOnlyTool,
  writingTool,
  type ToolContext,
  type ToolDefinition,
} from '../../tools/types.js';
import * as schema from './schemas.js';
import {
  askModule,
  askOrPrevious,
  isRecord,
  listIn,
  records,
  str,
  unknownShape,
  type Args,
} from './shared.js';

type Ref = { id: string; name: string };

function refs(value: unknown): Ref[] {
  const list = Array.isArray(value) ? value : isRecord(value) ? [value] : [];
  return list
    .filter(isRecord)
    .filter(entry => typeof entry['id'] === 'string')
    .map(entry => ({ id: entry['id'] as string, name: str(entry['name']) }));
}

async function previousGeneration(
  context: ToolContext,
  args: Args,
  remove: boolean
): Promise<Args> {
  const operation = remove ? 'remove actor ownership' : 'assign actor ownership';
  const actorPhrase = phrase(str(args['actorIdentifier']));
  const actorAnswer =
    actorPhrase === FRIENDLY_NPCS
      ? await askModule(context, 'getFriendlyNPCs', {}, operation)
      : actorPhrase === PARTY_CHARACTERS
        ? await askModule(context, 'getPartyCharacters', {}, operation)
        : await askModule(context, 'findActor', { identifier: args['actorIdentifier'] }, operation);
  const actors = refs(actorAnswer);
  const playerAnswer =
    phrase(str(args['playerIdentifier'])) === PARTY
      ? await askModule(context, 'getConnectedPlayers', {}, operation)
      : await askModule(
          context,
          'findPlayers',
          {
            identifier: args['playerIdentifier'],
            allowPartialMatch: false,
            includeCharacterOwners: true,
          },
          operation
        );
  const players = refs(playerAnswer);
  if (!actors.length)
    throw new Error(`Failed to ${operation}: no actor matches "${str(args['actorIdentifier'])}".`);
  if (!players.length)
    throw new Error(
      `Failed to ${operation}: no player matches "${str(args['playerIdentifier'])}".`
    );
  if (remove && args['confirmRemoval'] !== true)
    throw new Error(`Failed to ${operation}: nothing was changed; set confirmRemoval to true.`);
  if ((actors.length > 1 || players.length > 1) && args['confirmBulkOperation'] !== true) {
    throw new Error(
      `Failed to ${operation}: Bulk operation detected: ${actors.length} actors × ${players.length} players = ` +
        `${actors.length * players.length} ownership changes. Nothing was changed. Set confirmBulkOperation to true to proceed.`
    );
  }
  const level = remove ? 0 : (levelNumber(args['permissionLevel']) ?? 0);
  const results: Args[] = [];
  for (const actor of actors) {
    for (const player of players) {
      try {
        const answer = await askModule(
          context,
          'setActorOwnership',
          { actorId: actor.id, userId: player.id, permission: level },
          operation
        );
        results.push({
          actorName: actor.name,
          playerName: player.name,
          success: true,
          message:
            (isRecord(answer) && str(answer['message'])) ||
            `Set ${actor.name} ownership for ${player.name}.`,
        });
      } catch (error) {
        results.push({
          actorName: actor.name,
          playerName: player.name,
          success: false,
          message: messageOf(error),
        });
      }
    }
  }
  const failed = results.filter(result => result['success'] !== true).length;
  if (failed === results.length) {
    throw new Error(
      `Failed to ${operation}: ${results.map(result => str(result['message'])).join(' ')}`
    );
  }
  return {
    summary: `${results.length - failed} ownership ${remove ? 'removals' : 'assignments'} completed${failed ? `, ${failed} failed` : ''}`,
    results,
    notes: remove
      ? [
          'The connected Foundry module is of the previous generation: removing writes NONE instead of deleting the entry, so a higher default level of the actor no longer applies to these players.',
        ]
      : ['The connected Foundry module is of the previous generation.'],
  };
}

export function formatOwnershipChange(answer: unknown): string {
  if (!isRecord(answer) || !Array.isArray(answer['results'])) return unknownShape(answer);
  const lines = [str(answer['summary'])];
  for (const result of records(answer['results'])) {
    lines.push(`${result['success'] === true ? '-' : '- FAILED:'} ${str(result['message'])}`);
  }
  for (const note of Array.isArray(answer['notes']) ? answer['notes'] : [])
    lines.push(`Note: ${str(note)}`);
  return lines.join('\n');
}

function ownershipTool(remove: boolean): ToolDefinition['handler'] {
  return async (args, context) => {
    const data: Args = {
      actorIdentifier: args['actorIdentifier'],
      playerIdentifier: args['playerIdentifier'],
      confirmBulkOperation: args['confirmBulkOperation'] === true,
      ...(remove
        ? { remove: true, confirmRemoval: args['confirmRemoval'] === true }
        : { permissionLevel: args['permissionLevel'] }),
    };
    const answer = await askOrPrevious(
      context,
      'changeActorOwnership',
      data,
      remove ? 'remove actor ownership' : 'assign actor ownership',
      () => previousGeneration(context, args, remove)
    );
    return formatOwnershipChange(answer);
  };
}

export const assignActorOwnershipTool: ToolDefinition = {
  name: 'assign-actor-ownership',
  title: 'Assign actor ownership',
  group: 'actors',
  description:
    'Give players a permission level on actors, e.g. make John the owner of Aragorn, or give the party observer access ' +
    'to all friendly NPCs of the active scene. Actors and players are matched exactly (id or name, case does not ' +
    'matter), never by part of a name; Gamemasters are never changed. More than one actor or player needs ' +
    'confirmBulkOperation. Each pair is read back and reported, unchanged pairs included.',
  inputSchema: schema.assignActorOwnershipSchema,
  annotations: writingTool('Assign actor ownership', { destructive: false, idempotent: true }),
  handler: ownershipTool(false),
};

export const removeActorOwnershipTool: ToolDefinition = {
  name: 'remove-actor-ownership',
  title: 'Remove actor ownership',
  group: 'actors',
  description:
    'Remove the explicit permission a player has on an actor, so the default level of the actor applies again; the ' +
    'answer warns when that default still grants access. To hide an actor completely from a player, assign NONE with ' +
    'assign-actor-ownership instead. Needs confirmRemoval, and confirmBulkOperation when more than one actor or player ' +
    'is affected.',
  inputSchema: schema.removeActorOwnershipSchema,
  annotations: writingTool('Remove actor ownership', { destructive: true, idempotent: true }),
  handler: ownershipTool(true),
};

export function formatOwnershipList(answer: unknown): string {
  const list = listIn(answer, 'ownership');
  if (!list) return unknownShape(answer);
  if (!list.length) return 'No actors in this world.';
  const lines: string[] = [];
  for (const actor of list.filter(isRecord)) {
    if (!Array.isArray(actor['players'])) {
      lines.push(JSON.stringify(actor));
      continue;
    }
    lines.push(
      `${str(actor['name'])} (${str(actor['type'])}, id ${str(actor['id'])}), default ${str(actor['defaultLevel'], 'NONE')}:`
    );
    const players = records(actor['players']);
    if (!players.length) lines.push('  no players in this world');
    for (const player of players) {
      lines.push(
        `  - ${str(player['name'])}: ${str(player['levelName'])} (${String(player['level'])})${player['explicit'] === true ? '' : ', from the default'}`
      );
    }
  }
  return lines.join('\n');
}

export const listActorOwnershipTool: ToolDefinition = {
  name: 'list-actor-ownership',
  title: 'List actor ownership',
  group: 'actors',
  description:
    'Show which level every player effectively has on actors, and whether it is set for that player or comes from the ' +
    'default level of the actor. One actor or all, one player or all; Gamemasters are left out because they own everything.',
  inputSchema: schema.listActorOwnershipSchema,
  annotations: readOnlyTool('List actor ownership'),
  handler: async (args, context) => {
    const data: Args = {};
    for (const key of ['actorIdentifier', 'playerIdentifier'])
      if (args[key] !== undefined) data[key] = args[key];
    return formatOwnershipList(
      await askModule(context, 'getActorOwnership', data, 'list actor ownership')
    );
  },
};
