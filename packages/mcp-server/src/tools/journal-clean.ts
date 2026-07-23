import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

/**
 * Clean, general-purpose JournalEntry tools.
 *
 * Unlike the quest-oriented tools, these store page content VERBATIM (no quest
 * template, no "Quest Modified" wrapper, no auto-appended junk page) and can
 * REPLACE and DELETE pages/journals. Content is full HTML — include headings
 * (<h2>), images (<img src="Bilder/...">), and content links (@UUID[...]).
 */
export class JournalCleanTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor(options: { foundryClient: FoundryClient; logger: Logger }) {
    this.foundryClient = options.foundryClient;
    this.logger = options.logger;
  }

  getToolDefinitions() {
    return [
      {
        name: 'journal-create',
        description:
          'Create a CLEAN multi-page JournalEntry with NO quest template / no junk page. Provide pages as an array of {name, html}; each page content is stored verbatim (full HTML incl. <h2>, <img>, @UUID[...] links). Returns the new journalId.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Journal entry (document) name' },
            folderName: {
              type: 'string',
              description: 'Sidebar folder name (created if missing)',
            },
            pages: {
              type: 'array',
              description: 'Ordered list of pages to create',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Page title' },
                  html: { type: 'string', description: 'Full HTML content, stored verbatim' },
                },
                required: ['name', 'html'],
              },
              minItems: 1,
            },
          },
          required: ['name', 'pages'],
        },
      },
      {
        name: 'journal-set-page',
        description:
          "Replace a journal page's content verbatim (clean overwrite — no appending, no wrapper). Use the page id from list-journals.",
        inputSchema: {
          type: 'object',
          properties: {
            journalId: { type: 'string' },
            pageId: { type: 'string' },
            html: { type: 'string', description: 'New full HTML content (replaces existing)' },
          },
          required: ['journalId', 'pageId', 'html'],
        },
      },
      {
        name: 'journal-add-page',
        description:
          'Add a new page to an existing journal with verbatim HTML content (clean, no quest wrapper).',
        inputSchema: {
          type: 'object',
          properties: {
            journalId: { type: 'string' },
            name: { type: 'string', description: 'New page title' },
            html: { type: 'string', description: 'Full HTML content, stored verbatim' },
          },
          required: ['journalId', 'name', 'html'],
        },
      },
      {
        name: 'journal-delete-page',
        description:
          'Permanently delete a single page from a journal. Get the pageId from list-journals. Cannot be undone.',
        inputSchema: {
          type: 'object',
          properties: {
            journalId: { type: 'string' },
            pageId: { type: 'string' },
          },
          required: ['journalId', 'pageId'],
        },
      },
      {
        name: 'journal-delete',
        description:
          'Permanently delete an entire JournalEntry and all its pages. Cannot be undone.',
        inputSchema: {
          type: 'object',
          properties: {
            journalId: { type: 'string' },
          },
          required: ['journalId'],
        },
      },
      {
        name: 'journal-rename',
        description: 'Rename a JournalEntry (change its display title).',
        inputSchema: {
          type: 'object',
          properties: {
            journalId: { type: 'string' },
            newName: { type: 'string', description: 'New journal title' },
          },
          required: ['journalId', 'newName'],
        },
      },
      {
        name: 'actor-set-token',
        description:
          "Set an actor's token image (prototype token) — fills the token for actors that have none. Optionally also set the portrait and enable the dynamic token ring (dnd5e/Foundry v12+).",
        inputSchema: {
          type: 'object',
          properties: {
            actorIdentifier: { type: 'string', description: 'Actor name or ID' },
            tokenImg: { type: 'string', description: 'Token image path' },
            portraitImg: {
              type: 'string',
              description: 'Optional portrait image path (actor.img)',
            },
            tokenName: {
              type: 'string',
              description:
                "Optional name for the prototype token. Without it, placed tokens keep the compendium name (e.g. 'Bandit') instead of the actor's name. Usually you want to pass the actor's own name here.",
            },
            ring: {
              type: 'boolean',
              description:
                'Enable (true) or disable (false) the dynamic token ring. When true, tokenImg is also set as the ring subject texture — without that the ring would be drawn around an empty field. Omit to leave the current setting untouched.',
            },
            ringScale: {
              type: 'number',
              description:
                "Scale of the artwork inside the ring. Omit it — the token art should carry its own transparent margin instead (see the image tool's --token-margin). Shrinking the subject here leaves the ring at full size and looks out of proportion.",
            },
            ringColor: {
              type: 'string',
              description:
                'Optional ring colour as a hex string, e.g. "#e72124". Omit to colour automatically by disposition: hostile red, neutral blue, friendly green.',
            },
          },
          required: ['actorIdentifier', 'tokenImg'],
        },
      },
      {
        name: 'actor-refresh-from-source',
        description:
          "Refresh an actor's embedded items from the compendium they came from. Items on a sheet are frozen copies; if the source pack was later re-translated or its links fixed, the copies keep the old text. This re-pulls presentation fields (name / image / description with its @UUID links) from each item's stored source, leaving ALL mechanics untouched — levels, uses, prepared spells, quantity, equipped, attunement, advancement choices. No progress is lost. Items with no resolvable source (hand-made loot) are reported, never changed. ALWAYS run with dryRun first.",
        inputSchema: {
          type: 'object',
          properties: {
            actorIdentifier: { type: 'string', description: 'Actor name or ID' },
            fields: {
              type: 'array',
              items: { type: 'string', enum: ['name', 'description', 'img'] },
              description: 'Which fields to refresh. Omit for all three.',
            },
            namePacks: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Optional fallback: compendium pack ids to resolve items by name when they carry no stored source. Priority order.',
            },
            dryRun: {
              type: 'boolean',
              description: 'Only report what would change (default false). Use this first.',
            },
          },
          required: ['actorIdentifier'],
        },
      },
      {
        name: 'journal-page-from-file',
        description:
          "Fill a journal page from an HTML file that already sits in Foundry's Data directory (upload it there first). The browser fetches the file straight from the Foundry server, so content of ANY size can be written — nothing crosses the MCP socket. Use this instead of journal-set-page for large imported chapters. Creates the page if pageId is omitted.",
        inputSchema: {
          type: 'object',
          properties: {
            journalId: { type: 'string' },
            path: {
              type: 'string',
              description:
                'Path relative to the Foundry Data directory, e.g. "Bilder/Kampagnen/PotA/kap2-de.html".',
            },
            pageId: {
              type: 'string',
              description: 'Existing page to overwrite. Omit to create a new page.',
            },
            pageName: {
              type: 'string',
              description: 'Name for the new page (only used when pageId is omitted).',
            },
          },
          required: ['journalId', 'path'],
        },
      },
      {
        name: 'journal-append-page',
        description:
          'Append an HTML chunk to an existing text page. Use for content too large for one call: create the page with the first chunk (journal-create or journal-add-page), then append the rest in ~40k-character chunks — a single oversized message would drop the Foundry socket. Chunks are joined verbatim, so split only at tag boundaries.',
        inputSchema: {
          type: 'object',
          properties: {
            journalId: { type: 'string' },
            pageId: { type: 'string', description: 'Text page to append to' },
            html: { type: 'string', description: 'HTML chunk to append verbatim' },
          },
          required: ['journalId', 'pageId', 'html'],
        },
      },
      {
        name: 'journal-split-page',
        description:
          'Split one oversized journal page into one page per section, detected by heading level. Runs INSIDE Foundry, so the content never travels over the bridge — works on pages of any size. Original markup (images, insets, links, dice formulas) is carried over untouched.',
        inputSchema: {
          type: 'object',
          properties: {
            journalId: { type: 'string' },
            pageId: { type: 'string', description: 'Page to split' },
            level: {
              type: 'number',
              description:
                'Split at headings up to this level (1 = only h1, 2 = h1+h2). Default 1. Use 2 for chapters whose sections are h2.',
            },
            deleteOriginal: {
              type: 'boolean',
              description:
                'Delete the oversized source page afterwards (default false — keep it until you verified the split).',
            },
            namePrefix: {
              type: 'string',
              description: 'Optional prefix for every created page name, e.g. "Kap. 2 —".',
            },
          },
          required: ['journalId', 'pageId'],
        },
      },
      {
        name: 'journal-rewrite-images',
        description:
          'Rewrite external image URLs in journal pages to local Foundry paths (keeps only the file name and puts it under localPrefix). Fixes imported adventures that point at a CDN. Runs inside Foundry. Use dryRun first.',
        inputSchema: {
          type: 'object',
          properties: {
            journalId: { type: 'string' },
            pageId: {
              type: 'string',
              description: 'Optional — restrict to one page. Omit to process every text page.',
            },
            urlPattern: {
              type: 'string',
              description:
                'Literal URL prefix to match, e.g. "https://cdn.5e.tools/". Matched against the img src.',
            },
            localPrefix: {
              type: 'string',
              description:
                'Local folder the file name is placed under, e.g. "Bilder/Kampagnen/PotA".',
            },
            dryRun: {
              type: 'boolean',
              description: 'Only report what would change (default false).',
            },
          },
          required: ['journalId', 'urlPattern', 'localPrefix'],
        },
      },
      {
        name: 'journal-link-tags',
        description:
          'Convert raw 5etools tags (@creature[Name|Src], @item[Name|Src]) left over from an import into real Foundry @UUID links, resolved against the given compendium packs — e.g. a German monster manual. Unresolved names are reported, never silently skipped. Runs inside Foundry. Use dryRun first.',
        inputSchema: {
          type: 'object',
          properties: {
            journalId: { type: 'string' },
            pageId: {
              type: 'string',
              description: 'Optional — restrict to one page. Omit to process every text page.',
            },
            actorPacks: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Actor compendium pack ids searched for @creature tags, in priority order (e.g. ["dnd-monster-manual-deutsch.actors","dnd5e.monsters"]).',
            },
            itemPacks: {
              type: 'array',
              items: { type: 'string' },
              description: 'Item compendium pack ids searched for @item tags, in priority order.',
            },
            dryRun: {
              type: 'boolean',
              description: 'Only report what would change (default false).',
            },
          },
          required: ['journalId'],
        },
      },
      {
        name: 'folder-rename',
        description:
          'Rename a sidebar Folder (identified by its current name, optionally by document type). Contents are kept.',
        inputSchema: {
          type: 'object',
          properties: {
            folderName: { type: 'string', description: 'Current folder name' },
            newName: { type: 'string', description: 'New folder name' },
            type: {
              type: 'string',
              description: 'Optional document type to disambiguate (e.g. "JournalEntry", "Actor")',
            },
          },
          required: ['folderName', 'newName'],
        },
      },
      {
        name: 'folder-delete',
        description:
          'Delete a sidebar Folder by name. By default keeps its contents (moves them up a level). Set deleteContents:true to delete contents too.',
        inputSchema: {
          type: 'object',
          properties: {
            folderName: { type: 'string' },
            type: { type: 'string', description: 'Optional document type to disambiguate' },
            deleteContents: {
              type: 'boolean',
              description: 'If true, also delete the folder contents (default false)',
            },
          },
          required: ['folderName'],
        },
      },
    ];
  }

  async handleCreate(args: {
    name: string;
    folderName?: string;
    pages: Array<{ name: string; html: string }>;
  }): Promise<any> {
    const pages = (args.pages || []).map(p => ({ name: p.name, content: p.html }));
    return await this.foundryClient.query('foundry-mcp-bridge.createCleanJournal', {
      name: args.name,
      folderName: args.folderName,
      pages,
    });
  }

  async handleSetPage(args: { journalId: string; pageId: string; html: string }): Promise<any> {
    return await this.foundryClient.query('foundry-mcp-bridge.updateJournalContent', {
      journalId: args.journalId,
      pageId: args.pageId,
      content: args.html,
    });
  }

  async handleAddPage(args: { journalId: string; name: string; html: string }): Promise<any> {
    return await this.foundryClient.query('foundry-mcp-bridge.updateJournalContent', {
      journalId: args.journalId,
      newPageName: args.name,
      content: args.html,
    });
  }

  async handleDeletePage(args: { journalId: string; pageId: string }): Promise<any> {
    return await this.foundryClient.query('foundry-mcp-bridge.deleteJournalPage', {
      journalId: args.journalId,
      pageId: args.pageId,
    });
  }

  async handleDelete(args: { journalId: string }): Promise<any> {
    return await this.foundryClient.query('foundry-mcp-bridge.deleteJournalEntry', {
      journalId: args.journalId,
    });
  }

  async handleRenameJournal(args: { journalId: string; newName: string }): Promise<any> {
    return await this.foundryClient.query('foundry-mcp-bridge.renameJournal', {
      journalId: args.journalId,
      newName: args.newName,
    });
  }

  async handleSetActorToken(args: {
    actorIdentifier: string;
    tokenImg: string;
    portraitImg?: string;
    tokenName?: string;
    ring?: boolean;
    ringScale?: number;
    ringColor?: string;
  }): Promise<any> {
    return await this.foundryClient.query('foundry-mcp-bridge.setActorToken', {
      actorIdentifier: args.actorIdentifier,
      tokenImg: args.tokenImg,
      portraitImg: args.portraitImg,
      tokenName: args.tokenName,
      ring: args.ring,
      ringScale: args.ringScale,
      ringColor: args.ringColor,
    });
  }

  async handleRefreshActorFromSource(args: {
    actorIdentifier: string;
    fields?: string[];
    namePacks?: string[];
    dryRun?: boolean;
  }): Promise<any> {
    return await this.foundryClient.query('foundry-mcp-bridge.refreshActorItemsFromSource', {
      actorIdentifier: args.actorIdentifier,
      fields: args.fields,
      namePacks: args.namePacks,
      dryRun: args.dryRun,
    });
  }

  async handleJournalPageFromFile(args: {
    journalId: string;
    path: string;
    pageId?: string;
    pageName?: string;
  }): Promise<any> {
    return await this.foundryClient.query('foundry-mcp-bridge.setJournalPageFromFile', {
      journalId: args.journalId,
      path: args.path,
      pageId: args.pageId,
      pageName: args.pageName,
    });
  }

  async handleAppendJournalPage(args: {
    journalId: string;
    pageId: string;
    html: string;
  }): Promise<any> {
    return await this.foundryClient.query('foundry-mcp-bridge.appendJournalPageContent', {
      journalId: args.journalId,
      pageId: args.pageId,
      html: args.html,
    });
  }

  async handleSplitJournalPage(args: {
    journalId: string;
    pageId: string;
    level?: number;
    deleteOriginal?: boolean;
    namePrefix?: string;
  }): Promise<any> {
    return await this.foundryClient.query('foundry-mcp-bridge.splitJournalPage', {
      journalId: args.journalId,
      pageId: args.pageId,
      level: args.level,
      deleteOriginal: args.deleteOriginal,
      namePrefix: args.namePrefix,
    });
  }

  async handleRewriteJournalImages(args: {
    journalId: string;
    pageId?: string;
    urlPattern: string;
    localPrefix: string;
    dryRun?: boolean;
  }): Promise<any> {
    return await this.foundryClient.query('foundry-mcp-bridge.rewriteJournalImages', {
      journalId: args.journalId,
      pageId: args.pageId,
      urlPattern: args.urlPattern,
      localPrefix: args.localPrefix,
      dryRun: args.dryRun,
    });
  }

  async handleLinkJournalTags(args: {
    journalId: string;
    pageId?: string;
    actorPacks?: string[];
    itemPacks?: string[];
    dryRun?: boolean;
  }): Promise<any> {
    return await this.foundryClient.query('foundry-mcp-bridge.linkJournalTags', {
      journalId: args.journalId,
      pageId: args.pageId,
      actorPacks: args.actorPacks,
      itemPacks: args.itemPacks,
      dryRun: args.dryRun,
    });
  }

  async handleRenameFolder(args: {
    folderName: string;
    newName: string;
    type?: string;
  }): Promise<any> {
    return await this.foundryClient.query('foundry-mcp-bridge.renameFolder', {
      folderName: args.folderName,
      newName: args.newName,
      type: args.type,
    });
  }

  async handleDeleteFolder(args: {
    folderName: string;
    type?: string;
    deleteContents?: boolean;
  }): Promise<any> {
    return await this.foundryClient.query('foundry-mcp-bridge.deleteFolder', {
      folderName: args.folderName,
      type: args.type,
      deleteContents: args.deleteContents,
    });
  }
}
