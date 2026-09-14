/**
 * Visible texts of the interface area, with an English fallback for every key.
 *
 * `game.i18n.localize` hands a missing key back unchanged, which would put a
 * raw dotted key into a window. Every lookup here falls back to the English
 * text instead. The table below is the same content as lang.en.json; a test
 * compares the two, so they cannot drift apart unnoticed.
 */
import { MODULE_ID } from '../../../common/constants.js';

export type TextData = Record<string, string | number>;

export const EN = {
  [MODULE_ID]: {
    settings: {
      willkommenGesehen: {
        name: 'Welcome window seen',
        hint: "Set by the button Don't show again in the welcome window. Stored per device.",
      },
      updateNoticeVersion: {
        name: 'Update notice acknowledged for version',
        hint: "Set by the button Done, don't show again in the update notice. Stored per device.",
      },
    },
    interface: {
      common: {
        notAvailable: 'Not available yet: {what}',
        save: 'Save',
        apply: 'Apply',
        failed: 'Failed: {reason}',
        gmOnly: 'Only a Gamemaster can use this window.',
      },
      updateNotice: {
        title: 'Update to {version}: set up the MCP server anew',
        heading: 'This version is a complete rewrite',
        intro:
          "Version {version} of Ninjo's Foundry MCP was rewritten from the ground up. The MCP server on your PC has to be set up completely anew with the new server package.",
        oldServer:
          'An MCP server of the previous generation is still connected. Set up the new server package as described below, then restart your MCP client.',
        stepsHeading: 'In short',
        step1: 'Download {file} from the releases page.',
        step2: 'Unpack the zip file.',
        step3: 'In the unpacked folder, double click setup.cmd.',
        step4: 'Quit Claude Desktop or your MCP client completely and start it again.',
        guideIntro: 'Mac, Claude Code, other clients and troubleshooting:',
        guideLink: 'installation guide',
        keeps: 'Your world settings and permissions stay as they are.',
        download: 'Open download page',
        downloadLabel: 'Open download page in a new tab',
        later: 'Remind me later',
        done: "Done, don't show again",
      },
      menu: {
        creatureIndex: {
          name: 'Creature index',
          label: 'Creature index',
          hint: 'Build the creature index again and choose whether it is used and rebuilt on its own.',
        },
        compendiumRelease: {
          name: 'Release compendiums',
          label: 'Release compendiums',
          hint: 'Choose which compendiums the AI may write to.',
        },
        mapGeneration: {
          name: 'Map generation',
          label: 'Map generation',
          hint: 'Check, start and stop the map service, and set its quality.',
        },
      },
      creatureIndex: {
        title: 'Creature index',
        intro:
          'The creature index keeps the most important values of every creature in the actor compendiums in one file in the world. Searching by challenge rating or creature type then reads that file instead of loading every compendium.',
        rebuildHeading: 'Build again',
        rebuildHint:
          'Needed after a compendium changed outside Foundry, for example after a module update. Large compendiums take a while.',
        rebuildButton: 'Build the index again',
        serviceMissing: 'the creature index comes with the compendium tools.',
        settingsHeading: 'Settings',
        enabled: 'Use the creature index',
        enabledHint:
          'Off: searching by criteria falls back to guessing from names and says so in its result.',
        autoRebuild: 'Rebuild on its own',
        autoRebuildHint:
          'Discards the index as soon as a creature in a compendium is created, changed or deleted. It is built again on the next search.',
        settingsMissing: 'these settings come with the compendium tools.',
      },
      release: {
        title: 'Release compendiums',
        intro:
          'Choose which compendiums the AI may write to. Reading is never restricted. The permission level for compendiums applies in addition.',
        allowAll: 'Allow every compendium that is not locked',
        allowAllHint:
          'Stays set as long as nothing below is ticked. A selection below always wins over this box.',
        world: 'World',
        system: 'Game system: {title}',
        column: {
          release: 'Release',
          name: 'Compendium',
          type: 'Type',
          entries: 'Entries',
          lock: 'Lock',
        },
        locked: 'locked',
        open: 'open',
        releaseOne: 'Release {name}',
        none: 'This world has no compendiums.',
        unmatched:
          '{count} entries on the list match no compendium present, for example from a deactivated module. They stay on the list: {entries}',
        serviceMissing: 'the release list comes with the compendium tools.',
        notStored: 'The release list was not stored as chosen. Stored now: {entries}',
        nothing: 'nothing',
        damaged:
          'The stored release list could not be read: {problem}. Until it is saved again, no compendium counts as released.',
      },
      mapGeneration: {
        title: 'Map generation',
        intro:
          'Battle maps are made by ComfyUI on the PC of the MCP server. Here you check the service, start and stop it, and set the quality.',
        serviceHeading: 'Service',
        state: 'State',
        stateUnknown: 'not checked yet',
        stateChecking: 'checking',
        stateStarting: 'starting. The first start with models can take several minutes.',
        stateStopping: 'stopping',
        stateRunning: 'running',
        stateStopped: 'stopped',
        stateError: 'error',
        stateDisabled: 'switched off on the server. Set COMFYUI_ENABLED=true there to make maps.',
        check: 'Check',
        start: 'Start',
        stop: 'Stop',
        serviceMissing: 'the map service comes with the map generator.',
        settingsHeading: 'Settings',
        autoStart: 'Start together with Foundry',
        autoStartHint:
          'Asks for the service to start when a Gamemaster loads the world. Off by default, because the service needs a lot of memory.',
        quality: 'Quality',
        qualityHint: 'More steps give a finer map and take longer.',
        low: 'Low (8 steps)',
        medium: 'Medium (20 steps)',
        high: 'High (35 steps)',
        settingsMissing: 'these settings come with the map generator.',
      },
      notify: {
        indexBuilding: 'The creature index is missing and is being built.',
        indexRebuilding: 'Rebuilding the creature index.',
        indexRebuilt: 'Creature index built: {creatures} creatures from {packs} compendiums.',
        indexRebuildFailed: 'The creature index could not be built: {reason}',
        indexSkipped: 'Creatures skipped while building the index: {count}.',
        indexNotStored:
          'The creature index was built but not stored: {reason}. It is built again on the next search.',
        indexSettingsSaved: 'Creature index settings saved.',
        releaseSaved: 'Release list saved, entries: {count}.',
        releaseAllowAll:
          'Release list emptied: the AI may write to every compendium that is not locked.',
        releaseFailed: 'The release list was not saved: {reason}',
        comfyAlreadyRunning: 'The map service is already running.',
        comfyStarting: 'Starting the map service.',
        comfyStarted: 'The map service is running.',
        comfyStartFailed: 'The map service did not start: {reason}',
        comfyStopped: 'Map service: {message}',
        comfyStopFailed: 'The map service could not be stopped: {reason}',
        backendMissing:
          'The MCP server is not connected, so the map service cannot be controlled from here.',
        mapgenSaved: 'Map generation settings saved.',
        mapJobFailed: 'The map {name} could not be made: {reason}',
        sceneCreated: 'Scene {name} created.',
        sceneSwitched: 'Switched to the scene {name}.',
        wallsCreated: 'Walls created: {count}.',
        noWalls: 'The detection found no usable walls.',
        gmOnlyProgress: 'Only a Gamemaster can change the campaign progress.',
        progressSaveFailed: 'The campaign progress was not saved: {reason}',
        progressUpdateFailed: 'The campaign progress was not updated: {reason}',
      },
    },
  },
  MCP: {
    Willkommen: {
      Untertitel: 'Your world, within reach of an AI assistant',
      Einleitung:
        'This module connects an AI assistant on your PC, such as Claude, to this world through the Model Context Protocol. The assistant reads journals, scenes and compendiums and writes to them as far as you allow.',
      Punkt1:
        "Only a Gamemaster's browser connects. The dot above the player list shows whether the bridge is up.",
      Punkt2:
        'Allow Write Operations and the permission levels in the module settings decide what the assistant may change. Deleting is off by default.',
      Punkt3:
        'Releasing compendiums and the creature index have their own windows in the module settings.',
      Start:
        'To start: set up the MCP server on the PC, open this world as Gamemaster and wait for the green dot.',
      ForgeZeile: 'More modules and web tools by Ninjo',
      Nie: "Don't show again",
      Spaeter: 'Later',
    },
  },
} as const;

/** The English text of a full key, or undefined when the table has none. */
export function fallbackFor(fullKey: string): string | undefined {
  let node: unknown = EN;
  // Module ids contain no dot, so splitting the full key is safe here.
  for (const part of fullKey.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

function fill(template: string, data?: TextData): string {
  if (!data) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(data, name) ? String(data[name]) : match
  );
}

/** Translate a full key; a missing translation shows the English text, never the key. */
export function tr(fullKey: string, data?: TextData): string {
  let translated: string | undefined;
  try {
    translated = game.i18n?.localize(fullKey);
  } catch {
    translated = undefined;
  }
  const text =
    translated && translated !== fullKey ? translated : (fallbackFor(fullKey) ?? fullKey);
  return fill(text, data);
}

/** A text of this package, under `ninjos-foundry-mcp.interface.`. */
export function t(key: string, data?: TextData): string {
  return tr(`${MODULE_ID}.interface.${key}`, data);
}
