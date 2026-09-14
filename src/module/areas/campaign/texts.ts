/**
 * Texts of the campaign area, with an English fallback for every key.
 *
 * The dashboard and the quest pages are written in the language of the
 * Gamemaster's client, not in fixed English. A missing
 * translation falls back to the English text of this table, never to a raw
 * key that would end up stored in a journal. A test compares the table with
 * lang.en.json.
 */
import { MODULE_ID } from '../../../common/constants.js';
import { escapeHtml } from '../interface/html.js';

export type CampaignTextData = Record<string, string | number>;

export const CAMPAIGN_EN = {
  [MODULE_ID]: {
    campaign: {
      status: {
        not_started: 'Not started',
        in_progress: 'In progress',
        completed: 'Completed',
        skipped: 'Skipped',
        toggle: '{part}: {status}. Activate to change the progress.',
      },
      dashboard: {
        journalName: '{title} (Campaign Dashboard)',
        pageName: 'Dashboard',
        overview: 'Overview',
        progress: 'Campaign progress: {done} of {total} parts done ({percent}%)',
        current: 'Current part: {part}',
        ready: 'Ready to begin',
        finished: 'Every part is done',
        location: 'Location: {location}',
        questGiver: 'Quest giver: {name}',
        partsHeading: 'Campaign parts',
        partsHint: 'Click a status to change the progress. It is saved right away.',
        part: 'Part {number}: {title}',
        subPart: '{number}: {title}',
        locked: '[Locked]',
        levels: 'Levels {start} to {end}',
        level: 'Level {level}',
        requires: 'Requires completion of: {part}',
        gmNote: 'Notes for the Gamemaster',
        created: 'Created on {date}.',
        campaignId: 'Campaign id: {id}',
        partType: {
          main_part: 'Main part',
          sub_part: 'Sub part',
          chapter: 'Chapter',
          session: 'Session',
          optional: 'Optional',
        },
      },
      templates: {
        fivePartAdventure: {
          hook: {
            title: 'Hook and introduction',
            description: 'The heroes are drawn into the adventure and learn what is at stake.',
          },
          investigation: {
            title: 'Investigation and clues',
            description:
              'The heroes gather information, follow traces and meet the first obstacles.',
          },
          midpoint: {
            title: 'Midpoint revelation',
            description:
              'A discovery changes how the heroes see the situation and raises the stakes.',
          },
          climax: {
            title: 'Climactic confrontation',
            description: 'The heroes face the main threat in a decisive encounter.',
          },
          resolution: {
            title: 'Resolution and rewards',
            description:
              'Loose ends are tied up, rewards are handed out and consequences become clear.',
          },
        },
        dungeonCrawl: {
          approach: {
            title: 'Approach and entry',
            description: 'The heroes travel to the dungeon and find a way inside.',
          },
          upper: {
            title: 'Upper levels',
            description: 'The first halls with their guards, traps and hints at what lies below.',
          },
          upperFirst: { title: 'Entrance halls', description: 'The first rooms and their guards.' },
          upperSecond: {
            title: 'Trapped passages',
            description: 'Deeper rooms with traps and a way further down.',
          },
          lower: {
            title: 'Lower levels',
            description: 'Harder encounters and the secrets of the dungeon.',
          },
          lowerFirst: {
            title: 'Deep halls',
            description: 'Strong opponents guard the way to the heart of the dungeon.',
          },
          lowerSecond: {
            title: 'Hidden chambers',
            description: 'Secrets, lore and the last obstacles before the lair.',
          },
          boss: {
            title: 'Final boss and treasure',
            description: 'The master of the dungeon and the hoard it guards.',
          },
        },
        investigation: {
          scene: {
            title: 'Crime scene',
            description: 'The heroes examine the place where it happened and secure first clues.',
          },
          witnesses: {
            title: 'Witness interviews',
            description: 'The heroes question people who saw or know something.',
          },
          witnessFirst: {
            title: 'First witnesses',
            description: 'People close to the event tell what they saw.',
          },
          witnessSecond: {
            title: 'Reluctant witnesses',
            description: 'Some know more than they admit and have to be persuaded.',
          },
          leads: {
            title: 'Following leads',
            description: 'The clues point to several places and people.',
          },
          leadFirst: { title: 'First lead', description: 'The most obvious trace.' },
          leadSecond: { title: 'Second lead', description: 'A trace that contradicts the first.' },
          leadThird: { title: 'Third lead', description: 'The trace that leads to the truth.' },
          confrontation: {
            title: 'Confrontation',
            description: 'The heroes face whoever is behind it.',
          },
          resolution: {
            title: 'Resolution',
            description: 'The truth comes to light and the consequences follow.',
          },
        },
        sandbox: {
          intro: {
            title: 'World introduction',
            description: 'The heroes get to know the region, its people and its conflicts.',
          },
          exploration: {
            title: 'Exploration phase',
            description: 'The heroes choose their own goals and explore freely.',
          },
          consequences: {
            title: 'Consequences and reactions',
            description: 'The world reacts to what the heroes have done.',
          },
          climax: {
            title: 'Player driven climax',
            description: 'The threads the heroes pulled on come together.',
          },
        },
      },
      quest: {
        pageName: 'Quest details',
        background: 'Background',
        backgroundLocation: 'The quest takes place in {location}.',
        backgroundGiver: '{name} asks the party for help.',
        backgroundNpc: '{name} plays a central part in it.',
        adjust: 'Adjust these details as needed for your campaign.',
        details: 'Quest details',
        statusColumn: 'Rewards and status',
        type: 'Type',
        difficulty: 'Difficulty',
        location: 'Location',
        keyFigure: 'Key figure',
        rewards: 'Rewards',
        status: 'Status',
        created: 'Created',
        hook: 'Adventure hook',
        hookGiver: '{name} approaches the party with a request.',
        hookRumour: 'A rumour is going around in {place}.',
        hookRumourAnywhere: 'A rumour is going around.',
        gmNote: 'Notes for the Gamemaster',
        gmDifficulty: 'Difficulty: {difficulty}.',
        gmType: 'Quest type: {type}.',
        gmAdvice: 'Adjust encounters and rewards to the strength of the party.',
        objectives: 'Quest objectives',
        objective: {
          fetch1: 'Find out where the sought item is.',
          fetch2: 'Obtain the item.',
          fetch3: 'Bring the item back safely.',
          escort1: 'Meet the person to be escorted.',
          escort2: 'Protect them on the way.',
          escort3: 'Reach the destination safely.',
          kill1: 'Find the target.',
          kill2: 'Defeat the target.',
          kill3: 'Bring proof of success.',
          mystery1: 'Gather clues.',
          mystery2: 'Question witnesses and suspects.',
          mystery3: 'Uncover the truth.',
          npc1: 'Find out more about {name}.',
          npc2: 'Travel to {location}.',
          npc3: 'Deal with {name}.',
          main: 'Complete the main objective: {summary}',
          reportGiver: 'Report back to {name} upon completion.',
          reportDefault: 'Report the outcome to the appropriate authorities.',
          claim: 'Claim the promised rewards.',
        },
        progressNotes: 'Progress notes',
        progressPlaceholder: 'Record here what the party achieves.',
        relatedNpcs: 'Related NPCs',
        npcEntry: '{npc}: {role}',
        statusValue: { active: 'Active', completed: 'Completed', failed: 'Failed' },
        questType: {
          main: 'main quest',
          side: 'side quest',
          personal: 'personal quest',
          mystery: 'mystery',
          fetch: 'fetch quest',
          escort: 'escort',
          kill: 'hunt',
          collection: 'collection',
        },
        difficultyValue: { easy: 'easy', medium: 'medium', hard: 'hard', deadly: 'deadly' },
        relationship: {
          quest_giver: 'quest giver',
          target: 'target',
          ally: 'ally',
          enemy: 'enemy',
          contact: 'contact',
        },
      },
      update: {
        progress: 'Progress update, {date}',
        completion: 'Quest completed, {date}',
        failure: 'Quest failed, {date}',
        modification: 'Quest modified, {date}',
      },
    },
  },
} as const;

/** The English text of a key below `ninjos-foundry-mcp.campaign.`, or undefined. */
export function campaignFallback(key: string): string | undefined {
  let node: unknown = CAMPAIGN_EN[MODULE_ID].campaign;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

function template(key: string): string {
  const full = `${MODULE_ID}.campaign.${key}`;
  let translated: string | undefined;
  try {
    translated = game.i18n?.localize(full);
  } catch {
    translated = undefined;
  }
  if (translated && translated !== full) return translated;
  return campaignFallback(key) ?? key;
}

function fill(text: string, data: CampaignTextData): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(data, name) ? String(data[name]) : match
  );
}

/** A text of this package as plain text. */
export function ct(key: string, data: CampaignTextData = {}): string {
  return fill(template(key), data);
}

/**
 * A text of this package as HTML. The translation is escaped, the values are
 * inserted as given, so they must already be HTML (escaped text or a link).
 */
export function ch(key: string, html: CampaignTextData = {}): string {
  return fill(escapeHtml(template(key)), html);
}

/** The language of the client, for dates in the content. */
export function clientLanguage(): string | undefined {
  const lang = (game.i18n as { lang?: unknown } | undefined)?.lang;
  return typeof lang === 'string' && lang ? lang : undefined;
}

/** Today as the client writes a date. */
export function today(now: Date = new Date()): string {
  try {
    return now.toLocaleDateString(clientLanguage());
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
