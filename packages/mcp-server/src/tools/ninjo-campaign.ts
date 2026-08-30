/**
 * NINJO-ERWEITERUNG
 *
 * Werkzeuge fuer den Kampagnenaufbau, die es im Ursprungsprojekt nicht gibt:
 * Wiedergabelisten, Kompendium-Import, Zufallstabellen, Notizen auf Szenen.
 *
 * Bewusst in einer eigenen Datei, damit ein Abgleich mit dem Upstream nichts
 * davon anfasst.
 */

import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

export interface NinjoCampaignToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

export class NinjoCampaignTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: NinjoCampaignToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'NinjoCampaignTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'list-playlists',
        description:
          'List the playlists in the world with their sounds. Use this to find the exact playlist and sound name before linking one to a scene, or to check whether a playlist referenced by a journal actually exists in the world.',
        inputSchema: {
          type: 'object',
          properties: {
            includeSounds: {
              type: 'boolean',
              description: 'Include the individual sounds of each playlist (default true)',
            },
          },
        },
      },
      {
        name: 'import-from-compendium',
        description:
          'Copy a document out of a compendium into the world — playlists, scenes, journals, actors, roll tables, anything. Always assigns a FRESH id, so it can never overwrite an existing world document. That is the difference to dragging an entry out of a compendium by hand, which keeps the id and silently replaces whatever carries the same one.',
        inputSchema: {
          type: 'object',
          properties: {
            packId: {
              type: 'string',
              description: 'Compendium id, e.g. "ninjo-kompendium.musik"',
            },
            entryName: {
              type: 'string',
              description: 'Name of the entry (exact match preferred, falls back to substring)',
            },
            entryId: { type: 'string', description: 'Id of the entry, alternative to entryName' },
            newName: { type: 'string', description: 'Rename on import' },
            folderPath: {
              type: 'string',
              description: 'Target folder, nested paths allowed',
            },
          },
          required: ['packId'],
        },
      },
      {
        name: 'set-scene-playlist',
        description:
          'Link a playlist, and optionally one specific sound, to a scene so it starts when the scene is activated. Pass an empty playlistName to remove the link. The playlist has to exist in the world; use import-from-compendium first if it only exists in a compendium.',
        inputSchema: {
          type: 'object',
          properties: {
            sceneIdentifier: { type: 'string', description: 'Scene name or id' },
            playlistName: {
              type: 'string',
              description: 'Playlist name or id. Empty string removes the link.',
            },
            soundName: {
              type: 'string',
              description: 'Optional single track inside that playlist',
            },
          },
          required: ['sceneIdentifier'],
        },
      },
      {
        name: 'list-roll-tables',
        description: 'List the roll tables in the world with their formula and number of results.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'create-roll-table',
        description:
          'Create a roll table from a list of text results. Ranges are assigned consecutively when omitted (first entry 1, second 2, and so on) and the dice formula is derived from the highest range, so a six-entry table becomes 1d6 by itself.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Table name' },
            description: { type: 'string', description: 'Optional description' },
            formula: {
              type: 'string',
              description: 'Dice formula, e.g. "1d6". Derived from the ranges if omitted.',
            },
            folderPath: { type: 'string', description: 'Target folder, nested paths allowed' },
            results: {
              type: 'array',
              description: 'The entries of the table, in order',
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string', description: 'Result text' },
                  range: {
                    type: 'array',
                    description: 'Optional [min, max] for this entry',
                    items: { type: 'number' },
                  },
                  weight: { type: 'number', description: 'Optional weight, default 1' },
                },
                required: ['text'],
              },
            },
          },
          required: ['name', 'results'],
        },
      },
      {
        name: 'create-scene-note',
        description:
          'Pin a journal entry, optionally a specific page, onto a scene at the given pixel coordinates. Use this to make the locations on a town map clickable.',
        inputSchema: {
          type: 'object',
          properties: {
            sceneIdentifier: { type: 'string', description: 'Scene name or id' },
            journalName: { type: 'string', description: 'Journal name or id' },
            pageName: { type: 'string', description: 'Optional page inside that journal' },
            x: { type: 'number', description: 'X coordinate in scene pixels' },
            y: { type: 'number', description: 'Y coordinate in scene pixels' },
            label: { type: 'string', description: 'Optional label shown next to the pin' },
            icon: {
              type: 'string',
              description: 'Optional icon path, default "icons/svg/book.svg"',
            },
            iconSize: { type: 'number', description: 'Icon size in pixels, default 40' },
          },
          required: ['sceneIdentifier', 'journalName', 'x', 'y'],
        },
      },
      {
        name: 'get-permissions',
        description:
          'Show what the AI is currently allowed to do per document kind: scenes, playlists, journals, roll tables, actors, folders. Each kind has three levels — read only, create and update, or additionally delete. Deleting is off by default everywhere. Call this when an action was refused, to see which switch has to be flipped in the module settings.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'delete-playlist',
        description:
          'Delete a playlist by its id. Refuses while the playlist is still linked to a scene, and names those scenes. Requires the playlist permission to be set to full.',
        inputSchema: {
          type: 'object',
          properties: {
            playlistId: { type: 'string', description: 'Id of the playlist' },
          },
          required: ['playlistId'],
        },
      },
      {
        name: 'delete-roll-table',
        description:
          'Delete a roll table by its id. Requires the roll table permission to be set to full.',
        inputSchema: {
          type: 'object',
          properties: {
            tableId: { type: 'string', description: 'Id of the roll table' },
          },
          required: ['tableId'],
        },
      },
      {
        name: 'list-compendiums',
        description:
          'List every compendium with its type, entry count and lock state. An unlocked compendium can be written to, no matter who ships it: many people keep their own collections as a module rather than inside the world. Call this before exporting to find the right pack id.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'create-compendium',
        description:
          'Create a new world compendium, for example to archive a finished chapter of a campaign. Choose the document type it will hold.',
        inputSchema: {
          type: 'object',
          properties: {
            label: {
              type: 'string',
              description: 'Display name, e.g. "Geheimnisse der Abgruende, Akt 0"',
            },
            type: {
              type: 'string',
              description:
                'What it holds: Actor, Item, Scene, JournalEntry, RollTable, Playlist, Macro, Cards or Adventure',
            },
          },
          required: ['label', 'type'],
        },
      },
      {
        name: 'list-compendium-entries',
        description:
          'List what actually sits inside a compendium — ids, names, types and folders. list-compendiums only gives counts, so this is the way to check whether an archive holds what it should, to find duplicates, or to get the ids needed for any later work. Reads the index only, never the full documents, and pages through at most 1000 entries per call. Read-only: it changes nothing and works regardless of the permission level.',
        inputSchema: {
          type: 'object',
          properties: {
            packId: {
              type: 'string',
              description:
                'Compendium id, e.g. world.archiv-salzmarsch or ninjo-kompendium.presets',
            },
            namePattern: {
              type: 'string',
              description: 'Only entries whose name contains this text (case-insensitive)',
            },
            folderName: {
              type: 'string',
              description: 'Only entries sitting in this folder inside the compendium',
            },
            limit: {
              type: 'number',
              description: 'How many entries to return, default 200, at most 1000',
            },
            offset: {
              type: 'number',
              description: 'Skip this many entries — use with hasMore to page through a large pack',
            },
          },
          required: ['packId'],
        },
      },
      {
        name: 'delete-compendium-entries',
        description:
          'Remove named entries from a compendium — by id, or by exact name. Only what is explicitly named is removed; there is deliberately no "empty this pack". Always run with dryRun first: it reports exactly what would go, what was not found, and which names are ambiguous, without touching anything. Names are matched exactly, never as a substring, and an ambiguous name is reported rather than guessed. If the selection happens to cover every entry in the pack, confirmLabel is required as well. Needs the compendium permission on "create, edit and delete".',
        inputSchema: {
          type: 'object',
          properties: {
            packId: { type: 'string', description: 'Compendium id' },
            ids: {
              type: 'array',
              description: 'Ids of the entries to remove — get them from list-compendium-entries',
              items: { type: 'string' },
            },
            names: {
              type: 'array',
              description: 'Exact names, as an alternative to ids. Ambiguous names are reported.',
              items: { type: 'string' },
            },
            unlockIfNeeded: {
              type: 'boolean',
              description: 'Lift the lock for this operation only and restore it afterwards',
            },
            dryRun: {
              type: 'boolean',
              description: 'Report what would happen and change nothing. Use this first.',
            },
            confirmLabel: {
              type: 'string',
              description:
                'Only needed when the selection covers every entry in the pack — then it must be the exact label',
            },
          },
          required: ['packId'],
        },
      },
      {
        name: 'delete-compendium',
        description:
          'Remove a world compendium and everything in it. This cannot be undone, so it is off by default: the module setting for compendiums has to stand on "create, edit and delete". The exact label must be passed as confirmLabel. Compendiums belonging to a module or to the game system cannot be removed this way.',
        inputSchema: {
          type: 'object',
          properties: {
            packId: { type: 'string', description: 'Compendium id, e.g. world.archiv-salzmarsch' },
            confirmLabel: {
              type: 'string',
              description: 'The exact label of the compendium, guarding against a mistyped id',
            },
          },
          required: ['packId', 'confirmLabel'],
        },
      },
      {
        name: 'export-to-compendium',
        description:
          'Copy documents from the world into a compendium, to archive finished material. Select what to copy by name or by the folder they sit in; without either, everything of that type is copied. A locked compendium is refused unless unlockIfNeeded is set, in which case the lock is lifted for this operation only and restored afterwards.',
        inputSchema: {
          type: 'object',
          properties: {
            packId: { type: 'string', description: 'Target compendium id' },
            documentType: {
              type: 'string',
              description: 'JournalEntry, Scene, Actor, RollTable, Playlist, Item or Macro',
            },
            names: {
              type: 'array',
              description: 'Names or ids to copy. Omit to take everything of that type.',
              items: { type: 'string' },
            },
            folderName: { type: 'string', description: 'Only documents sitting in this folder' },
            unlockIfNeeded: {
              type: 'boolean',
              description: 'Lift the lock for this operation and restore it afterwards',
            },
          },
          required: ['packId', 'documentType'],
        },
      },
      {
        name: 'set-compendium-lock',
        description:
          'Lock or unlock a compendium. Which ones may be touched follows the module settings: by default every unlocked compendium, or only the ones listed under writable compendiums if that field has been filled in.',
        inputSchema: {
          type: 'object',
          properties: {
            packId: { type: 'string', description: 'Compendium id' },
            locked: { type: 'boolean', description: 'true locks, false unlocks' },
          },
          required: ['packId', 'locked'],
        },
      },
      {
        name: 'organize-compendium',
        description:
          'Sort entries of a compendium into a folder, creating the folder if needed. Use this to bring order into an archive that has grown. Same lock rules as export-to-compendium.',
        inputSchema: {
          type: 'object',
          properties: {
            packId: { type: 'string', description: 'Compendium id' },
            folderName: { type: 'string', description: 'Folder to move the entries into' },
            entryNames: {
              type: 'array',
              description: 'Names of the entries to move',
              items: { type: 'string' },
            },
            unlockIfNeeded: { type: 'boolean' },
          },
          required: ['packId', 'folderName', 'entryNames'],
        },
      },
      {
        name: 'refresh-scene-thumb',
        description:
          'Regenerate the thumbnail of a scene. After swapping a background the sidebar keeps showing the old picture until this runs.',
        inputSchema: {
          type: 'object',
          properties: {
            sceneIdentifier: { type: 'string', description: 'Scene name or id' },
          },
          required: ['sceneIdentifier'],
        },
      },
    ];
  }

  async handleListPlaylists(args: any): Promise<any> {
    const schema = z.object({ includeSounds: z.boolean().optional() });
    const params = schema.parse(args ?? {});

    const result = await this.foundryClient.query('ninjos-foundry-mcp.listPlaylists', params);

    if (!result?.playlists?.length) {
      return { content: [{ type: 'text', text: 'Keine Wiedergabelisten in der Welt.' }] };
    }

    const text = result.playlists
      .map((p: any) => {
        const head = `${p.name}  (${p.soundCount} Stuecke, Id ${p.id})`;
        if (!p.sounds?.length) return head;
        return head + '\n' + p.sounds.map((s: any) => `    ${s.name}  [${s.id}]`).join('\n');
      })
      .join('\n');

    return { content: [{ type: 'text', text }] };
  }

  async handleImportFromCompendium(args: any): Promise<any> {
    const schema = z.object({
      packId: z.string().min(1),
      entryName: z.string().optional(),
      entryId: z.string().optional(),
      newName: z.string().optional(),
      folderPath: z.string().optional(),
    });
    const params = schema.parse(args);
    this.logger.info('Importing from compendium', params);

    const result = await this.foundryClient.query(
      'ninjos-foundry-mcp.importFromCompendium',
      params
    );

    return {
      content: [
        {
          type: 'text',
          text: `${result.type} "${result.name}" aus ${result.pack} importiert.\nNeue Id: ${result.id}`,
        },
      ],
    };
  }

  async handleSetScenePlaylist(args: any): Promise<any> {
    const schema = z.object({
      sceneIdentifier: z.string().min(1),
      playlistName: z.string().nullable().optional(),
      soundName: z.string().nullable().optional(),
    });
    const params = schema.parse(args);

    const result = await this.foundryClient.query('ninjos-foundry-mcp.setScenePlaylist', params);

    const text = result.playlist
      ? `Szene "${result.scene}": Wiedergabeliste "${result.playlist}"${
          result.sound ? `, Stueck "${result.sound}"` : ''
        }`
      : `Szene "${result.scene}": Verknuepfung entfernt`;

    return { content: [{ type: 'text', text }] };
  }

  async handleListRollTables(): Promise<any> {
    const result = await this.foundryClient.query('ninjos-foundry-mcp.listRollTables');

    if (!result?.tables?.length) {
      return { content: [{ type: 'text', text: 'Keine Zufallstabellen in der Welt.' }] };
    }

    const text = result.tables
      .map((t: any) => `${t.name}  (${t.formula}, ${t.resultCount} Eintraege, Id ${t.id})`)
      .join('\n');

    return { content: [{ type: 'text', text }] };
  }

  async handleCreateRollTable(args: any): Promise<any> {
    const schema = z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      formula: z.string().optional(),
      folderPath: z.string().optional(),
      results: z
        .array(
          z.object({
            text: z.string().min(1),
            range: z.array(z.number()).length(2).optional(),
            weight: z.number().optional(),
          })
        )
        .min(1),
    });
    const params = schema.parse(args);
    this.logger.info('Creating roll table', { name: params.name });

    const result = await this.foundryClient.query('ninjos-foundry-mcp.createRollTable', params);

    return {
      content: [
        {
          type: 'text',
          text: `Zufallstabelle "${result.name}" angelegt (${result.formula}, ${result.resultCount} Eintraege)\nId: ${result.id}`,
        },
      ],
    };
  }

  async handleCreateSceneNote(args: any): Promise<any> {
    const schema = z.object({
      sceneIdentifier: z.string().min(1),
      journalName: z.string().min(1),
      pageName: z.string().optional(),
      x: z.number(),
      y: z.number(),
      label: z.string().optional(),
      icon: z.string().optional(),
      iconSize: z.number().optional(),
    });
    const params = schema.parse(args);

    const result = await this.foundryClient.query('ninjos-foundry-mcp.createSceneNote', params);

    return {
      content: [
        {
          type: 'text',
          text: `Notiz auf "${result.scene}" gesetzt: "${result.journal}" bei ${result.x}/${result.y}`,
        },
      ],
    };
  }

  async handleGetPermissions(): Promise<any> {
    const result = await this.foundryClient.query('ninjos-foundry-mcp.getPermissions');

    const head = result.writeOperationsEnabled
      ? 'Schreiben ist grundsaetzlich erlaubt.'
      : 'ACHTUNG: "Allow Write Operations" ist aus, die KI aendert gar nichts.';

    const rows = result.permissions
      .map((p: any) => {
        const stufe =
          p.level === 'full'
            ? 'anlegen, aendern, loeschen'
            : p.level === 'write'
              ? 'anlegen, aendern'
              : 'nur lesen';
        return `${p.label.padEnd(18)} ${stufe}`;
      })
      .join('\n');

    return { content: [{ type: 'text', text: `${head}\n\n${rows}` }] };
  }

  async handleDeletePlaylist(args: any): Promise<any> {
    const schema = z.object({ playlistId: z.string().min(1) });
    const params = schema.parse(args);
    const result = await this.foundryClient.query('ninjos-foundry-mcp.deletePlaylist', params);
    return { content: [{ type: 'text', text: `Wiedergabeliste "${result.name}" geloescht.` }] };
  }

  async handleDeleteRollTable(args: any): Promise<any> {
    const schema = z.object({ tableId: z.string().min(1) });
    const params = schema.parse(args);
    const result = await this.foundryClient.query('ninjos-foundry-mcp.deleteRollTable', params);
    return { content: [{ type: 'text', text: `Zufallstabelle "${result.name}" geloescht.` }] };
  }

  async handleListCompendiums(): Promise<any> {
    const result = await this.foundryClient.query('ninjos-foundry-mcp.listCompendiums');
    const packs = result?.compendiums ?? [];

    if (!packs.length) {
      return { content: [{ type: 'text', text: 'Keine Kompendien vorhanden.' }] };
    }

    const offen = packs.filter((p: any) => p.writable);
    const gesperrt = packs.filter((p: any) => !p.writable);

    const zeile = (p: any) => `  ${p.label}  [${p.id}]  ${p.type}, ${p.entries} Eintraege`;

    const teile: string[] = [];
    if (offen.length) {
      teile.push(`Entsperrt, also bearbeitbar (${offen.length}):`);
      teile.push(offen.map(zeile).join('\n'));
    }
    if (gesperrt.length) {
      teile.push('');
      teile.push(`Gesperrt (${gesperrt.length}), zum Bearbeiten erst entsperren:`);
      teile.push(gesperrt.map(zeile).join('\n'));
    }

    return { content: [{ type: 'text', text: teile.join('\n') }] };
  }

  async handleCreateCompendium(args: any): Promise<any> {
    const schema = z.object({ label: z.string().min(1), type: z.string().min(1) });
    const params = schema.parse(args);
    this.logger.info('Creating compendium', params);

    const result = await this.foundryClient.query('ninjos-foundry-mcp.createCompendium', params);
    return {
      content: [
        {
          type: 'text',
          text: `Kompendium "${result.label}" angelegt (${result.type})\nId: ${result.id}`,
        },
      ],
    };
  }

  async handleDeleteCompendiumEntries(args: any): Promise<any> {
    const schema = z.object({
      packId: z.string().min(1),
      ids: z.array(z.string()).optional(),
      names: z.array(z.string()).optional(),
      unlockIfNeeded: z.boolean().optional(),
      dryRun: z.boolean().optional(),
      confirmLabel: z.string().optional(),
    });
    const params = schema.parse(args);
    this.logger.info('Deleting compendium entries', {
      pack: params.packId,
      dryRun: params.dryRun === true,
    });

    const result = await this.foundryClient.query(
      'ninjos-foundry-mcp.deleteCompendiumEntries',
      params
    );

    const teile: string[] = [];
    if (result.dryRun) {
      teile.push(
        `Trockenlauf fuer "${result.label}": ${result.wouldDelete} von ${result.totalInPack} ` +
          `Eintraegen wuerden entfernt. Es wurde nichts geaendert.`
      );
    } else {
      teile.push(
        `Aus "${result.label}" entfernt: ${result.deleted} Eintraege. ` +
          `Im Kompendium verbleiben ${result.totalInPack}.`
      );
    }

    if (result.entries?.length) {
      const zeigen = result.entries.slice(0, 25);
      teile.push('\n' + zeigen.map((e: any) => `  ${e.name}  ${e.id}`).join('\n'));
      if (result.entries.length > zeigen.length) {
        teile.push(`  ... und ${result.entries.length - zeigen.length} weitere`);
      }
    }

    // Nicht Gefundenes und Mehrdeutiges gehoert deutlich in die Antwort. Wird es
    // nur im Feld gemeldet, gilt der Vorgang leicht als vollstaendig erledigt,
    // obwohl die Haelfte gar nicht getroffen wurde.
    if (result.notFound?.length) {
      teile.push(`\nNicht gefunden (${result.notFound.length}): ${result.notFound.join(', ')}`);
    }
    if (result.ambiguous?.length) {
      teile.push(
        `\nMehrdeutig, deshalb uebergangen:\n` +
          result.ambiguous
            .map((m: any) => `  "${m.name}" kommt ${m.ids.length}x vor: ${m.ids.join(', ')}`)
            .join('\n') +
          `\nHier ueber ids gehen statt ueber names.`
      );
    }

    return { content: [{ type: 'text', text: teile.join('\n') }] };
  }

  async handleListCompendiumEntries(args: any): Promise<any> {
    const schema = z.object({
      packId: z.string().min(1),
      namePattern: z.string().optional(),
      folderName: z.string().optional(),
      limit: z.number().int().positive().max(1000).optional(),
      offset: z.number().int().min(0).optional(),
    });
    const params = schema.parse(args);
    this.logger.info('Listing compendium entries', { pack: params.packId });

    const result = await this.foundryClient.query(
      'ninjos-foundry-mcp.listCompendiumEntries',
      params
    );

    const kopf =
      `Kompendium "${result.label}" (${result.documentType}, ${result.packageType}` +
      `${result.locked ? ', gesperrt' : ''}): ${result.total} Eintraege` +
      (result.total !== result.returned
        ? `, davon ${result.returned} ab Position ${result.offset}`
        : '');

    const zeilen = result.entries.map(
      (e: any) =>
        `  ${e.name ?? '(ohne Namen)'}${e.type ? ` [${e.type}]` : ''}` +
        `${e.folder ? ` — Ordner: ${e.folder}` : ''}  ${e.id}`
    );

    // Der Hinweis auf hasMore gehoert in den Text, nicht nur ins Feld: Sonst
    // wird eine erste Seite fuer den ganzen Bestand gehalten - derselbe
    // Fehlschluss, der beim Export schon einmal einen fertigen Stand verwarf.
    const fuss = result.hasMore
      ? `\n\nEs gibt weitere Eintraege. Naechste Seite mit offset: ${result.offset + result.returned}`
      : '';

    return {
      content: [
        {
          type: 'text',
          text: `${kopf}\n\n${zeilen.join('\n')}${fuss}`,
        },
      ],
    };
  }

  async handleDeleteCompendium(args: any): Promise<any> {
    const schema = z.object({
      packId: z.string().min(1),
      confirmLabel: z.string().min(1),
    });
    const params = schema.parse(args);
    this.logger.info('Deleting compendium', { pack: params.packId });

    const result = await this.foundryClient.query('ninjos-foundry-mcp.deleteCompendium', params);
    return {
      content: [
        {
          type: 'text',
          text: `Kompendium "${result.label}" geloescht, mit ${result.entries} Eintraegen.`,
        },
      ],
    };
  }

  async handleExportToCompendium(args: any): Promise<any> {
    const schema = z.object({
      packId: z.string().min(1),
      documentType: z.string().min(1),
      names: z.array(z.string()).optional(),
      folderName: z.string().optional(),
      unlockIfNeeded: z.boolean().optional(),
    });
    const params = schema.parse(args);
    this.logger.info('Exporting to compendium', { pack: params.packId });

    const result = await this.foundryClient.query('ninjos-foundry-mcp.exportToCompendium', params);

    const neu: string[] = result.exported ?? [];
    const ersetzt: string[] = result.replaced ?? [];

    const zeilen = [`Nach "${result.pack}" gesichert: ${neu.length + ersetzt.length} Eintraege`];
    if (neu.length) {
      zeilen.push(`Neu angelegt (${neu.length}):`);
      zeilen.push(neu.map((n: string) => `  ${n}`).join('\n'));
    }
    // Beim Sichern bleibt die Kennung erhalten, ein vorhandener Eintrag wird also
    // ueberschrieben. Ohne diesen Hinweis wundert man sich, warum die Anzahl im
    // Kompendium gleich bleibt.
    if (ersetzt.length) {
      zeilen.push(`Vorhandenen Stand ueberschrieben (${ersetzt.length}):`);
      zeilen.push(ersetzt.map((n: string) => `  ${n}`).join('\n'));
    }
    if (result.skipped?.length) {
      zeilen.push(`Uebersprungen: ${result.skipped.join(', ')}`);
    }

    return { content: [{ type: 'text', text: zeilen.join('\n') }] };
  }

  async handleSetCompendiumLock(args: any): Promise<any> {
    const schema = z.object({ packId: z.string().min(1), locked: z.boolean() });
    const params = schema.parse(args);

    const result = await this.foundryClient.query('ninjos-foundry-mcp.setCompendiumLock', params);
    return {
      content: [
        {
          type: 'text',
          text: `"${result.pack}" ist jetzt ${result.locked ? 'gesperrt' : 'entsperrt'}.`,
        },
      ],
    };
  }

  async handleOrganizeCompendium(args: any): Promise<any> {
    const schema = z.object({
      packId: z.string().min(1),
      folderName: z.string().min(1),
      entryNames: z.array(z.string()).min(1),
      unlockIfNeeded: z.boolean().optional(),
    });
    const params = schema.parse(args);

    const result = await this.foundryClient.query('ninjos-foundry-mcp.organizeCompendium', params);
    return {
      content: [
        {
          type: 'text',
          text:
            `In "${result.pack}" nach "${result.folder}" verschoben: ` +
            `${result.moved.length} Eintraege${result.moved.length ? '\n  ' + result.moved.join('\n  ') : ''}`,
        },
      ],
    };
  }

  async handleRefreshSceneThumb(args: any): Promise<any> {
    const schema = z.object({ sceneIdentifier: z.string().min(1) });
    const params = schema.parse(args);

    const result = await this.foundryClient.query('ninjos-foundry-mcp.refreshSceneThumb', params);

    return {
      content: [
        {
          type: 'text',
          text: result.updated
            ? `Vorschaubild von "${result.scene}" erneuert.`
            : `Vorschaubild von "${result.scene}" konnte nicht erzeugt werden.`,
        },
      ],
    };
  }
}
