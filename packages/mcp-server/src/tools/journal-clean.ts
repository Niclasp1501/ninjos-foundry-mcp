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
