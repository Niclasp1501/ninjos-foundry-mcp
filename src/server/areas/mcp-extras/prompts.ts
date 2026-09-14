/**
 * The prompts of the mcp-extras area: guided Gamemaster workflows.
 *
 * A prompt only writes instructions for the model; the work happens in tool
 * calls the client shows. Every prompt reads first and asks the Gamemaster
 * before it changes the world. Texts are English for the model; nothing here
 * is shown inside Foundry.
 *
 * Two prompts need the game system and ask for it while they are built. When
 * it cannot be detected, the text says so with the cause instead of guessing.
 */
import type { SystemAdapterRegistry } from '../../../common/game-systems.js';
import type { SystemDetector } from '../../../common/system-detection.js';
import type { PromptResult } from '../../control/api.js';
import { activeGameSystem, type ActiveServerSystem } from '../../game-systems.js';
import type { PromptDefinition, ResourceContext } from '../../tools/resources.js';
import { completeFrom, completeJournalId, completeSceneId, DIFFICULTIES } from './lookup.js';

export interface PromptSources {
  registry?: SystemAdapterRegistry;
  detector?: SystemDetector;
}

function said(text: string): PromptResult {
  return { messages: [{ role: 'user', content: { type: 'text', text } }] };
}

function lines(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string').join('\n');
}

/** An argument as the Gamemaster typed it, quoted so it reads as data. */
function quoted(value: string): string {
  return JSON.stringify(value.trim());
}

const READ_FIRST =
  'Work by reading first. Do not create, change or delete anything in the world unless the Gamemaster confirms ' +
  'the concrete change after seeing it; where a tool offers dryRun, run it with dryRun first.';

const REPORT_GAPS =
  'Name the journals, scenes and actors you used. When something could not be read, say what and why instead of filling the gap.';

async function systemOf(
  context: ResourceContext,
  sources: PromptSources
): Promise<ActiveServerSystem> {
  return activeGameSystem(context, sources);
}

function systemLine(system: ActiveServerSystem): string {
  if (system.detection.problem) {
    return (
      `The game system could not be detected (${system.detection.problem}). Call get-world-info first; ` +
      'if no Foundry module is connected, stop and tell the Gamemaster.'
    );
  }
  if (!system.adapter) {
    return (
      `The world runs the game system "${system.rawId}", for which this server has no adapter: only generic ` +
      'actor data, name, type and compendium filters are available, and no system rules. Say so where it matters.'
    );
  }
  return `The world runs ${system.title} ("${system.rawId}"${system.version ? `, version ${system.version}` : ''}).`;
}

export function prepareSessionPrompt(): PromptDefinition {
  return {
    name: 'prepare-session',
    title: 'Prepare the next session',
    description:
      'Read the journals, scenes and actors of the world and write a preparation for the next game session.',
    arguments: [
      {
        name: 'journalId',
        description: 'Journal that describes the current adventure; without it the model searches.',
      },
      { name: 'focus', description: 'What the session should concentrate on, in your words.' },
    ],
    complete: { journalId: completeJournalId },
    build: args =>
      said(
        lines(
          'You help the Gamemaster of a Foundry VTT world prepare the next game session.',
          READ_FIRST,
          '',
          '1. Read the resource foundry://world/overview, or call get-world-info, list-scenes and list-journals, to learn the world, its game system, its scenes and journals.',
          args['journalId']
            ? `2. Read the journal foundry://journal/${args['journalId']} (list-journals with journalId ${quoted(args['journalId'])}) and every page of it that matters for the session.`
            : '2. Find the journals that describe the current adventure: search-journals with the names of places, people and quests, then read them with list-journals and journalId.',
          '3. Collect open threads: unfinished quests, promises the party made, clues not followed, people waiting for the party.',
          '4. Look at the scenes that will likely be used (foundry://scene/<id>) and the actors involved (foundry://actor/<id>).',
          '',
          'Then write the preparation with these parts: where the story stands, in a few sentences; open threads; likely scenes in order with their purpose; the non-player characters with motivation and one line of their voice; possible encounters; what to prepare in Foundry (scenes, tokens, handouts), as suggestions only.',
          args['focus']
            ? `The Gamemaster wants the session to focus on: ${quoted(args['focus'])}.`
            : null,
          REPORT_GAPS
        )
      ),
  };
}

export function buildEncounterPrompt(sources: PromptSources = {}): PromptDefinition {
  return {
    name: 'build-encounter',
    title: 'Build an encounter',
    description:
      'Build a combat encounter for the party from the compendiums, using the rules of the game system adapter where there is one.',
    arguments: [
      { name: 'difficulty', description: 'easy, medium, hard or deadly; default medium.' },
      { name: 'theme', description: 'Kind of opponents or situation, in your words.' },
      {
        name: 'sceneId',
        description: 'Scene the encounter takes place in; default the active scene.',
      },
    ],
    complete: { difficulty: completeFrom(DIFFICULTIES), sceneId: completeSceneId },
    build: async (args, context) => {
      const system = await systemOf(context, sources);
      const creatures = system.adapter?.creatures;
      const filterNames = creatures?.filters.map(filter => filter.name) ?? [];
      return said(
        lines(
          'You help the Gamemaster of a Foundry VTT world build a combat encounter for the party.',
          systemLine(system),
          creatures
            ? `list-creatures-by-criteria knows these filters in this system: ${filterNames.join(', ') || 'only the neutral ones'}` +
                `${creatures.power ? `; the strength of a creature is its ${creatures.power.name}` : ''}. Use them to find candidates of the right strength.`
            : 'Without creature rules of an adapter, find candidates with search-compendium and list-creatures-by-criteria by name and type, judge their strength from the data you read with get-compendium-entry-full, and call it an estimate.',
          READ_FIRST,
          '',
          '1. Find the party: list-characters with type "character" (or the player character type of this system), then get-character for each.',
          args['sceneId']
            ? `2. Read the scene foundry://scene/${args['sceneId']} to know the terrain.`
            : '2. Read foundry://scene/active to know the terrain.',
          `3. Choose opponents for a ${args['difficulty'] ? quoted(args['difficulty']) : '"medium"'} encounter${args['theme'] ? ` with the theme ${quoted(args['theme'])}` : ''}. Prefer creatures from the compendiums over invented ones.`,
          '4. Present two options: opponents with numbers and compendium ids, why the difficulty fits the party, tactics, and how the terrain plays in.',
          '5. Only after the Gamemaster chose: import or place what is needed (import-from-compendium, create-actor-from-compendium), then create-combat and add-combatants. Do not roll initiative or start the combat unless asked.',
          REPORT_GAPS
        )
      );
    },
  };
}

export function summarizeLastSessionPrompt(): PromptDefinition {
  return {
    name: 'summarize-last-session',
    title: 'Summarise the last session',
    description:
      'Write a recap of the last session from the chat log, the change log and the combat encounters.',
    arguments: [
      {
        name: 'since',
        description: 'Start of the session as a date and time, e.g. 2026-09-13T18:00:00Z.',
      },
      {
        name: 'saveToJournal',
        description: 'yes to offer saving the recap as a journal page after you read it.',
      },
    ],
    complete: { saveToJournal: completeFrom(['yes', 'no']) },
    build: args =>
      said(
        lines(
          'You help the Gamemaster of a Foundry VTT world write a recap of the last game session.',
          READ_FIRST,
          '',
          args['since']
            ? `1. Read the chat with list-chat-messages and since ${quoted(args['since'])}; page back with beforeId until the start of the session.`
            : '1. Read the chat with list-chat-messages, paging back with beforeId, and find where the last session started from the gaps in the times.',
          '2. Read foundry://changes/recent for what the AI changed in the world. The change log only covers the time since the Gamemaster last loaded the world; say so if it looks incomplete.',
          '3. Look at list-combats for fights of the session.',
          '',
          'Write the recap in the past tense, from the view of the party: what happened in order, decisions they made, what they found or received, who they met, and the threads left open. Keep what the players saw apart from what only the Gamemaster knows: whispers to the Gamemaster, Gamemaster rolls and hidden changes go into a separate part marked "Gamemaster only". Mark guesses as guesses.',
          args['saveToJournal']?.toLowerCase() === 'yes'
            ? 'Afterwards, propose a journal and page name for the recap and write it with journal-create or journal-add-page only after the Gamemaster agrees. Read it back with list-journals and report its id.'
            : null,
          REPORT_GAPS
        )
      ),
  };
}

export function createNpcPrompt(sources: PromptSources = {}): PromptDefinition {
  return {
    name: 'create-npc',
    title: 'Create a non-player character',
    description:
      'Draft a non-player character for the active game system and create it after the Gamemaster agrees.',
    arguments: [
      { name: 'concept', description: 'Who the character is, in your words.', required: true },
      { name: 'name', description: 'Name, if already chosen.' },
      { name: 'level', description: 'Level, challenge or strength in the terms of the system.' },
    ],
    build: async (args, context) => {
      const system = await systemOf(context, sources);
      const tools = system.adapter?.tools ?? [];
      return said(
        lines(
          'You help the Gamemaster of a Foundry VTT world create a non-player character.',
          systemLine(system),
          tools.length
            ? `This system has tools of its own for it: ${tools.join(', ')}. Prefer them over generic ones.`
            : 'This system has no tools of its own for it: call describe-document-type with Actor to learn its actor types and fields, then use manage-actors or create-document.',
          READ_FIRST,
          '',
          `Concept: ${quoted(args['concept'] ?? '')}.`,
          args['name'] ? `Name: ${quoted(args['name'])}.` : 'Suggest a name that fits the world.',
          args['level'] ? `Strength: ${quoted(args['level'])}.` : null,
          '',
          '1. Search the compendiums for a fitting base (search-compendium, list-creatures-by-criteria); a copy of an existing creature beats invented values.',
          '2. Draft the character and show it: role, appearance, personality, motivation, a secret, and the game values the system needs.',
          '3. Only after the Gamemaster agrees: create it (with dryRun first where the tool has it), then read it back with get-character and report its id and anything that did not come out as drafted.',
          REPORT_GAPS
        )
      );
    },
  };
}

export function describeScenePrompt(): PromptDefinition {
  return {
    name: 'describe-scene-for-players',
    title: 'Describe the scene for the players',
    description:
      'Write a read-aloud description of a scene with only what the characters can perceive.',
    arguments: [
      { name: 'sceneId', description: 'Scene to describe; default the active scene.' },
      { name: 'tone', description: 'Mood or style of the description, in your words.' },
    ],
    complete: { sceneId: completeSceneId },
    build: args =>
      said(
        lines(
          'You help the Gamemaster of a Foundry VTT world describe a scene to the players.',
          'Only read; post nothing to the chat unless the Gamemaster asks for it afterwards.',
          '',
          args['sceneId']
            ? `1. Read foundry://scene/${args['sceneId']}. You may look at it with get-scene-image and sceneIdentifier ${quoted(args['sceneId'])}.`
            : '1. Read foundry://scene/active. You may look at it with get-scene-image.',
          '2. Use the scene name, the background, the notes and the visible tokens to understand the place.',
          '',
          'Write one or two paragraphs to read aloud, in the second person plural, describing only what the characters perceive on arrival: sight, sound, smell, light. Then list up to five things they can notice or interact with.',
          'Never reveal hidden tokens, traps, secret doors, Gamemaster notes, journal content marked for the Gamemaster, or the names of creatures the characters do not know.',
          args['tone'] ? `Tone: ${quoted(args['tone'])}.` : null,
          'If the scene could not be read, say so and why.'
        )
      ),
  };
}

export function mcpExtrasPrompts(sources: PromptSources = {}): PromptDefinition[] {
  return [
    prepareSessionPrompt(),
    buildEncounterPrompt(sources),
    summarizeLastSessionPrompt(),
    createNpcPrompt(sources),
    describeScenePrompt(),
  ];
}
