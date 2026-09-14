/**
 * Who speaks a chat message: an actor, a token, or only an alias.
 *
 * The speaker is always built from the arguments. Foundry's `getSpeaker()`
 * without arguments takes the token the Gamemaster happens to have selected,
 * so a message would speak as whatever is selected on the canvas at that
 * moment. Without speaker arguments the message speaks as the user.
 */
import { QueryError } from '../../dispatcher.js';
import { byIdOrExactName, findActor, idOf, optionalText } from './lookup.js';

export interface ChatSpeaker {
  scene: string | null;
  actor: string | null;
  token: string | null;
  alias?: string;
}

export interface ResolvedSpeaker {
  speaker: ChatSpeaker;
  label: string;
  actor: FoundryDocument | null;
  token: FoundryChatTablesToken | null;
}

function findScene(ref: string): FoundryChatTablesScene {
  const scene = byIdOrExactName<FoundryChatTablesScene>(game.scenes, ref, 'scene');
  if (!scene) throw new QueryError('NOT_FOUND', `Scene "${ref}" not found by id or exact name.`);
  return scene;
}

/** A token by uuid, or by id on the given scene or on every scene. Never by name. */
export function findToken(ref: string, sceneRef: string | undefined): FoundryChatTablesToken {
  if (ref.includes('.')) {
    const found = fromUuidSync(ref);
    if (!found || found.documentName !== 'Token')
      throw new QueryError('NOT_FOUND', `No token has the uuid "${ref}".`);
    return found as FoundryChatTablesToken;
  }
  const scenes = sceneRef
    ? [findScene(sceneRef)]
    : (game.scenes.contents as unknown as FoundryChatTablesScene[]);
  const hits = scenes.flatMap(scene => {
    const token = scene.tokens?.get(ref);
    return token ? [{ scene, token }] : [];
  });
  if (hits.length > 1) {
    throw new QueryError(
      'AMBIGUOUS',
      `The token id "${ref}" is on ${hits.length} scenes: ` +
        `${hits.map(hit => `"${hit.scene.name}" (id ${hit.scene.id})`).join(', ')}. Pass sceneId or the token uuid.`
    );
  }
  const [hit] = hits;
  if (!hit) {
    throw new QueryError(
      'NOT_FOUND',
      `No token has the id "${ref}"${sceneRef ? ` on scene "${sceneRef}"` : ' on any scene'}. ` +
        'Tokens are found by id or uuid, not by name.'
    );
  }
  return hit.token;
}

/** The speaker from `speakerActor`, `speakerToken`, `sceneId` and `alias`, or null when none is given. */
export function resolveSpeaker(input: Record<string, unknown>): ResolvedSpeaker | null {
  const actorRef = optionalText(input, 'speakerActor')?.trim() || undefined;
  const tokenRef = optionalText(input, 'speakerToken')?.trim() || undefined;
  const sceneRef = optionalText(input, 'sceneId')?.trim() || undefined;
  const alias = optionalText(input, 'alias')?.trim() || undefined;

  if (sceneRef && !tokenRef) {
    throw new QueryError(
      'INVALID_ARGUMENT',
      'sceneId only narrows speakerToken; pass speakerToken as well'
    );
  }

  if (tokenRef) {
    const token = findToken(tokenRef, sceneRef);
    const actorId = idOf(token.actorId);
    const actor = actorId ? (game.actors.get(actorId) ?? null) : null;
    if (actorRef) {
      const named = findActor(actorRef);
      if (named.id !== actorId) {
        throw new QueryError(
          'INVALID_ARGUMENT',
          `speakerToken "${tokenRef}" belongs to ${actor ? `actor "${actor.name ?? ''}" (id ${actor.id})` : 'no actor'}, ` +
            `not to speakerActor "${actorRef}". Pass only one of them.`
        );
      }
    }
    const label = alias ?? token.name ?? actor?.name ?? token.id;
    return {
      speaker: { scene: token.parent?.id ?? null, actor: actorId, token: token.id, alias: label },
      label,
      actor,
      token,
    };
  }

  if (actorRef) {
    const actor = findActor(actorRef);
    const label = alias ?? actor.name ?? actor.id;
    return {
      speaker: { scene: null, actor: actor.id, token: null, alias: label },
      label,
      actor,
      token: null,
    };
  }

  if (alias) {
    return {
      speaker: { scene: null, actor: null, token: null, alias },
      label: alias,
      actor: null,
      token: null,
    };
  }
  return null;
}
