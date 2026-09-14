/**
 * What server and module agree on about tokens, free of Foundry.
 *
 * - the words for a token's disposition, including Foundry's "secret"
 * - which fields update-token may change and the rule for each
 * - the nested shape the server shows for get-token-details, built from the
 *   flat answer both module generations send
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Foundry's token dispositions. -2 is "secret", which the previous generation could not set. */
export const DISPOSITIONS: Readonly<Record<string, number>> = {
  secret: -2,
  hostile: -1,
  neutral: 0,
  friendly: 1,
};

export function dispositionWord(value: unknown): string {
  for (const [word, number] of Object.entries(DISPOSITIONS)) if (number === value) return word;
  return 'unknown';
}

/** Fields update-token accepts, in the order they are listed in messages. */
export const TOKEN_UPDATE_KEYS = [
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'hidden',
  'disposition',
  'name',
  'elevation',
  'lockRotation',
] as const;

export type TokenUpdateKey = (typeof TOKEN_UPDATE_KEYS)[number];

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Check the `updates` of update-token. Every problem is collected, so the model
 * fixes all of them in one retry. Unknown keys are refused instead of being
 * dropped: a change the model believes it made must not vanish unseen.
 */
export function readTokenUpdates(raw: unknown): {
  updates: Partial<Record<TokenUpdateKey, unknown>>;
  problems: string[];
} {
  const problems: string[] = [];
  const updates: Partial<Record<TokenUpdateKey, unknown>> = {};
  if (!isRecord(raw)) return { updates, problems: ['updates must be an object'] };

  const known = new Set<string>(TOKEN_UPDATE_KEYS);
  const unknown = Object.keys(raw).filter(key => !known.has(key));
  if (unknown.length) {
    problems.push(
      `updates holds fields this tool cannot change: ${unknown.join(', ')}. Allowed: ${TOKEN_UPDATE_KEYS.join(', ')}`
    );
  }

  for (const key of TOKEN_UPDATE_KEYS) {
    const value = raw[key];
    if (value === undefined) continue;
    switch (key) {
      case 'x':
      case 'y':
      case 'elevation':
        if (!finite(value)) problems.push(`updates.${key} must be a finite number`);
        break;
      case 'width':
      case 'height':
        if (!finite(value) || value <= 0)
          problems.push(`updates.${key} must be a number above 0 (grid spaces)`);
        break;
      case 'rotation':
        if (!finite(value) || value < 0 || value > 360)
          problems.push('updates.rotation must be a number from 0 to 360 (degrees)');
        break;
      case 'hidden':
      case 'lockRotation':
        if (typeof value !== 'boolean') problems.push(`updates.${key} must be true or false`);
        break;
      case 'disposition':
        if (!Object.values(DISPOSITIONS).includes(value as number))
          problems.push(
            'updates.disposition must be -2 (secret), -1 (hostile), 0 (neutral) or 1 (friendly)'
          );
        break;
      case 'name':
        if (typeof value !== 'string' || !value.trim())
          problems.push('updates.name must be a text that is not empty');
        break;
    }
    updates[key] = value;
  }
  if (Object.keys(raw).length === 0)
    problems.push('updates is empty, so there is nothing to change');
  return { updates, problems };
}

const num = (value: unknown, fallback: number | null = null): number | null =>
  finite(value) ? value : fallback;

/**
 * The flat answer of get-token-details (both module generations) as the
 * server shows it: position, size, appearance, behaviour, actor, and the
 * scene when the module names it.
 */
export function nestedTokenDetails(flat: Record<string, unknown>): Record<string, unknown> {
  const actorData = isRecord(flat['actorData']) ? flat['actorData'] : null;
  const actorId = typeof flat['actorId'] === 'string' && flat['actorId'] ? flat['actorId'] : null;
  const details: Record<string, unknown> = {
    id: flat['id'] ?? null,
    name: flat['name'] ?? null,
    position: { x: num(flat['x']), y: num(flat['y']) },
    size: { width: num(flat['width']), height: num(flat['height']) },
    appearance: {
      rotation: num(flat['rotation'], 0),
      scale: num(flat['scale'], 1),
      alpha: num(flat['alpha'], 1),
      hidden: flat['hidden'] === true,
      img: typeof flat['img'] === 'string' ? flat['img'] : null,
    },
    behavior: {
      disposition: dispositionWord(flat['disposition']),
      elevation: num(flat['elevation'], 0),
      lockRotation: flat['lockRotation'] === true,
    },
    actor: actorData
      ? {
          id: actorId ?? actorData['id'] ?? null,
          name: actorData['name'] ?? null,
          type: actorData['type'] ?? null,
          img: actorData['img'] ?? null,
          isLinked: flat['actorLink'] === true,
        }
      : null,
  };
  if (!actorData && actorId) details['actorMissing'] = actorId;
  if (isRecord(flat['scene'])) details['scene'] = flat['scene'];
  return details;
}
