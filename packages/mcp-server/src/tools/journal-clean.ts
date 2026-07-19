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
}
