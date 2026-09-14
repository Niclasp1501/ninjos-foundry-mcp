/**
 * The URIs of the mcp-extras area and which of them a write can touch.
 *
 * One scheme, `foundry://`, the one the scenes area chose for the world
 * information. Kind first, then the id, so a prefix names a whole family:
 * `foundry://journal/` covers every journal and page.
 */
import type { ToolGroup } from '../../tools/types.js';

export const SCHEME = 'foundry://';

export const URIS = {
  worldInfo: 'foundry://world/info',
  worldOverview: 'foundry://world/overview',
  activeScene: 'foundry://scene/active',
  scene: 'foundry://scene/{sceneId}',
  journal: 'foundry://journal/{journalId}',
  journalPage: 'foundry://journal/{journalId}/page/{pageId}',
  actor: 'foundry://actor/{actorId}',
  compendiums: 'foundry://compendiums',
  compendium: 'foundry://compendium/{packId}',
  activeCombat: 'foundry://combat/active',
  combat: 'foundry://combat/{combatId}',
  recentChanges: 'foundry://changes/recent',
} as const;

const CHANGES = 'foundry://changes/';
const WORLD = ['foundry://world/'];
const SCENES = 'foundry://scene/';
const JOURNALS = 'foundry://journal/';
const ACTORS = 'foundry://actor/';
const COMBATS = 'foundry://combat/';
/** Covers `foundry://compendiums` and `foundry://compendium/<id>`. */
const COMPENDIUMS = 'foundry://compendium';

/**
 * The prefixes a successful write of a tool in `group` may have changed.
 * Generous where a group reaches into several kinds; everything for the
 * groups that can change anything (documents, macros, world) and for tools of
 * other modules, whose effect this server cannot know.
 */
export function prefixesForWrite(group: ToolGroup | null): string[] {
  switch (group) {
    case 'scenes':
    case 'canvas':
      return [CHANGES, SCENES, ...WORLD];
    case 'tokens':
      return [CHANGES, SCENES, ACTORS, COMBATS, ...WORLD];
    case 'journals':
    case 'campaign':
      return [CHANGES, JOURNALS, ...WORLD];
    case 'actors':
    case 'systems':
    case 'effects':
      return [CHANGES, ACTORS, COMBATS, ...WORLD];
    case 'compendiums':
      return [CHANGES, COMPENDIUMS];
    case 'combat':
      return [CHANGES, COMBATS, ...WORLD];
    case 'chat':
    case 'dice':
    case 'rolltables':
    case 'playlists':
    case 'cards':
    case 'files':
      return [CHANGES];
    default:
      return [SCHEME];
  }
}
