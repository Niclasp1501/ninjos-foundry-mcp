import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

export interface SceneToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

export class SceneTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: SceneToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'SceneTools' });
  }

  /**
   * Tool definitions for scene operations
   */
  getToolDefinitions() {
    return [
      /* NINJO-ERWEITERUNG: Szenen anlegen und pflegen */
      {
        name: 'create-scene',
        description:
          'Create a Foundry scene from an image or video that already exists in the Foundry data directory. Use this for background art, location scenes and battlemaps you generated or uploaded yourself. Dimensions are measured from the file automatically. Pass templateName to copy the settings of an existing scene (grid, lighting, module flags) without ever reusing its id, so nothing gets overwritten. folderPath accepts nested paths like "Orte/Neverwinter"; missing folders are created. journalIdentifier links a journal entry to the scene, optionally opening one page of it.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Scene name' },
            background: {
              type: 'string',
              description:
                'Path to the image or video inside the Foundry data directory, e.g. "Maps/Schwertküste/Neverwinter/Gefängnis/SC_Kerker.jpg"',
            },
            navName: {
              type: 'string',
              description:
                'Label shown in the scene navigation bar. Derived from the name automatically if omitted: the SC_ or BM_ prefix is dropped and underscores become spaces.',
            },
            folderPath: {
              type: 'string',
              description: 'Target folder, nested paths allowed, e.g. "Orte/Neverwinter"',
            },
            templateName: {
              type: 'string',
              description: 'Name or id of an existing scene whose settings should be copied',
            },
            width: { type: 'number', description: 'Override width in pixels' },
            height: { type: 'number', description: 'Override height in pixels' },
            padding: { type: 'number', description: 'Scene padding, default 0 or template value' },
            gridSize: { type: 'number', description: 'Grid size in pixels' },
            navigation: {
              type: 'boolean',
              description: 'Show in the scene navigation bar (default false)',
            },
            journalIdentifier: {
              type: 'string',
              description:
                'Journal to link to the scene, by name or id. Foundry shows it as the scene journal, which is different from a note placed on the map. An empty string removes the link.',
            },
            journalPageName: {
              type: 'string',
              description: 'Open this page of the journal, by name or id',
            },
            activate: { type: 'boolean', description: 'Activate the scene right away' },
          },
          required: ['name', 'background'],
        },
      },
      {
        name: 'update-scene',
        description:
          'Update an existing scene: rename it, swap its background image or video, move it to another folder, change its dimensions or navigation. When a new background is set and no dimensions are given, the new dimensions are measured from the file. journalIdentifier links or, when empty, unlinks the scene journal.',
        inputSchema: {
          type: 'object',
          properties: {
            sceneIdentifier: { type: 'string', description: 'Scene name or id' },
            name: { type: 'string', description: 'New name' },
            navName: {
              type: 'string',
              description:
                'Label in the navigation bar. Re-derived from the name when the name changes.',
            },
            background: { type: 'string', description: 'New background path' },
            backgroundColor: {
              type: 'string',
              description:
                'Background colour of the scene level as hex, e.g. "#000000". This is what shows around the artwork.',
            },
            folderPath: { type: 'string', description: 'Move to this folder path' },
            width: { type: 'number' },
            height: { type: 'number' },
            navigation: { type: 'boolean' },
            journalIdentifier: {
              type: 'string',
              description:
                'Journal to link to the scene, by name or id. Foundry shows it as the scene journal, which is different from a note placed on the map. An empty string removes the link.',
            },
            journalPageName: {
              type: 'string',
              description: 'Open this page of the journal, by name or id',
            },
          },
          required: ['sceneIdentifier'],
        },
      },
      {
        name: 'restore-scene',
        description:
          'Recreate a scene from a JSON file inside the Foundry data directory, complete with walls, tiles, lights, sounds and tokens. Meant for recovery: pull a deleted scene out of a world backup and put it back. The data travels as a file, not through the data channel, because a scene with walls easily runs to a hundred thousand characters and the channel breaks on large payloads. A fresh id is assigned unless keepId is set, so a recovery can never overwrite an existing scene.',
        inputSchema: {
          type: 'object',
          properties: {
            jsonPath: {
              type: 'string',
              description:
                'Path of the JSON file, counted from the Foundry data directory, e.g. "Bergung/szenen.json". The file may hold one scene or an array of them.',
            },
            index: { type: 'number', description: 'Which entry of the array to use, default 0' },
            name: { type: 'string', description: 'Give the restored scene a different name' },
            folderPath: { type: 'string', description: 'Target folder, nested paths allowed' },
            keepId: {
              type: 'boolean',
              description: 'Keep the original id. Only do this when the scene is truly gone.',
            },
            navigation: { type: 'boolean', description: 'Show in the scene navigation bar' },
          },
          required: ['jsonPath'],
        },
      },
      {
        name: 'list-scene-folders',
        description:
          'List all scene folders with their full path and how many scenes each contains. Use this before create-scene to find the right folderPath.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'delete-scene',
        description:
          'Permanently delete a scene by its id. The id is required on purpose so a scene with a similar name cannot be hit by accident. An active scene cannot be deleted; activate another one first.',
        inputSchema: {
          type: 'object',
          properties: {
            sceneId: { type: 'string', description: 'Id of the scene to delete' },
          },
          required: ['sceneId'],
        },
      },
      {
        name: 'get-current-scene',
        description:
          'Get information about the currently active scene, including tokens and layout',
        inputSchema: {
          type: 'object',
          properties: {
            includeTokens: {
              type: 'boolean',
              description: 'Whether to include detailed token information (default: true)',
              default: true,
            },
            includeHidden: {
              type: 'boolean',
              description: 'Whether to include hidden tokens and elements (default: false)',
              default: false,
            },
          },
        },
      },
      {
        name: 'get-world-info',
        description: 'Get basic information about the Foundry world and system',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ];
  }

  /* =========================================================================
   * NINJO-ERWEITERUNG: Szenen anlegen und pflegen
   * ========================================================================= */

  async handleCreateScene(args: any): Promise<any> {
    const schema = z.object({
      name: z.string().min(1),
      background: z.string().min(1),
      navName: z.string().optional(),
      folderPath: z.string().optional(),
      templateName: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      padding: z.number().optional(),
      gridSize: z.number().optional(),
      navigation: z.boolean().optional(),
      activate: z.boolean().optional(),
      journalIdentifier: z.string().optional(),
      journalPageName: z.string().optional(),
    });

    const params = schema.parse(args);
    this.logger.info('Creating scene', { name: params.name, background: params.background });

    try {
      const result = await this.foundryClient.query('foundry-mcp-bridge.createScene', params);

      const lines = [
        `Szene angelegt: ${result.name}`,
        `Id: ${result.id}`,
        `Groesse: ${result.width}x${result.height}${result.probed ? ' (aus der Datei gemessen)' : ''}`,
        result.template ? `Vorlage: ${result.template}` : 'Vorlage: keine',
        result.folder ? `Ordner-Id: ${result.folder}` : 'Ordner: keiner',
      ];
      if (result.journal) lines.push(`Journal: ${result.journal}`);

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (error) {
      this.logger.error('Failed to create scene', { error });
      throw new Error(
        `Szene konnte nicht angelegt werden: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`
      );
    }
  }

  async handleUpdateScene(args: any): Promise<any> {
    const schema = z.object({
      sceneIdentifier: z.string().min(1),
      name: z.string().optional(),
      navName: z.string().optional(),
      background: z.string().optional(),
      backgroundColor: z.string().optional(),
      folderPath: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      navigation: z.boolean().optional(),
      journalIdentifier: z.string().optional(),
      journalPageName: z.string().optional(),
    });

    const params = schema.parse(args);
    this.logger.info('Updating scene', { scene: params.sceneIdentifier });

    try {
      const result = await this.foundryClient.query('foundry-mcp-bridge.updateScene', params);
      return {
        content: [
          {
            type: 'text',
            text: `Szene "${result.name}" geaendert (${result.changed.join(', ')})`,
          },
        ],
      };
    } catch (error) {
      this.logger.error('Failed to update scene', { error });
      throw new Error(
        `Szene konnte nicht geaendert werden: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`
      );
    }
  }

  async handleRestoreScene(args: any): Promise<any> {
    const schema = z.object({
      jsonPath: z.string().min(1),
      index: z.number().optional(),
      name: z.string().optional(),
      folderPath: z.string().optional(),
      keepId: z.boolean().optional(),
      navigation: z.boolean().optional(),
    });
    const params = schema.parse(args);
    this.logger.info('Restoring scene', { file: params.jsonPath, index: params.index });

    try {
      const r = await this.foundryClient.query('foundry-mcp-bridge.restoreScene', params);
      return {
        content: [
          {
            type: 'text',
            text: [
              `Szene geborgen: ${r.name}`,
              `Id: ${r.id}`,
              `Groesse: ${r.width}x${r.height}`,
              `Enthalten: ${r.enthalten}`,
            ].join('\n'),
          },
        ],
      };
    } catch (error) {
      this.logger.error('Failed to restore scene', { error });
      throw new Error(
        `Szene konnte nicht geborgen werden: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`
      );
    }
  }

  async handleListSceneFolders(): Promise<any> {
    try {
      const result = await this.foundryClient.query('foundry-mcp-bridge.listSceneFolders');
      const folders = result?.folders || [];

      if (!folders.length) {
        return { content: [{ type: 'text', text: 'Keine Szenenordner vorhanden.' }] };
      }

      const text = folders
        .map((f: any) => `${f.path}  (${f.scenes} Szenen, Id ${f.id})`)
        .join('\n');

      return { content: [{ type: 'text', text }] };
    } catch (error) {
      this.logger.error('Failed to list scene folders', { error });
      throw new Error(
        `Szenenordner konnten nicht gelesen werden: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`
      );
    }
  }

  async handleDeleteScene(args: any): Promise<any> {
    const schema = z.object({ sceneId: z.string().min(1) });
    const params = schema.parse(args);
    this.logger.info('Deleting scene', params);

    try {
      const result = await this.foundryClient.query('foundry-mcp-bridge.deleteScene', params);
      return { content: [{ type: 'text', text: `Szene "${result.name}" geloescht.` }] };
    } catch (error) {
      this.logger.error('Failed to delete scene', { error });
      throw new Error(
        `Szene konnte nicht geloescht werden: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`
      );
    }
  }

  /* ================= ENDE NINJO-ERWEITERUNG ================= */

  async handleGetCurrentScene(args: any): Promise<any> {
    const schema = z.object({
      includeTokens: z.boolean().default(true),
      includeHidden: z.boolean().default(false),
    });

    const { includeTokens, includeHidden } = schema.parse(args);

    this.logger.info('Getting current scene information', { includeTokens, includeHidden });

    try {
      const sceneData = await this.foundryClient.query('foundry-mcp-bridge.getActiveScene');

      this.logger.debug('Successfully retrieved scene data', {
        sceneId: sceneData.id,
        sceneName: sceneData.name,
        tokenCount: sceneData.tokens?.length || 0,
      });

      return this.formatSceneResponse(sceneData, includeTokens, includeHidden);
    } catch (error) {
      this.logger.error('Failed to get current scene', error);
      throw new Error(
        `Failed to get current scene: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async handleGetWorldInfo(_args: any): Promise<any> {
    this.logger.info('Getting world information');

    try {
      const worldData = await this.foundryClient.query('foundry-mcp-bridge.getWorldInfo');

      this.logger.debug('Successfully retrieved world data', {
        worldId: worldData.id,
        system: worldData.system,
      });

      return this.formatWorldResponse(worldData);
    } catch (error) {
      this.logger.error('Failed to get world information', error);
      throw new Error(
        `Failed to get world information: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private formatSceneResponse(sceneData: any, includeTokens: boolean, includeHidden: boolean): any {
    const response: any = {
      id: sceneData.id,
      name: sceneData.name,
      active: sceneData.active,
      dimensions: {
        width: sceneData.width,
        height: sceneData.height,
        padding: sceneData.padding,
      },
      hasBackground: !!sceneData.background,
      navigation: sceneData.navigation,
      elements: {
        walls: sceneData.walls || 0,
        lights: sceneData.lights || 0,
        sounds: sceneData.sounds || 0,
        notes: sceneData.notes?.length || 0,
      },
    };

    if (includeTokens && sceneData.tokens) {
      response.tokens = this.formatTokens(sceneData.tokens, includeHidden);
      response.tokenSummary = this.createTokenSummary(sceneData.tokens, includeHidden);
    }

    if (sceneData.notes && sceneData.notes.length > 0) {
      response.notes = sceneData.notes.map((note: any) => ({
        id: note.id,
        text: this.truncateText(note.text, 100),
        position: { x: note.x, y: note.y },
      }));
    }

    return response;
  }

  private formatTokens(tokens: any[], includeHidden: boolean): any[] {
    return tokens
      .filter(token => includeHidden || !token.hidden)
      .map(token => ({
        id: token.id,
        name: token.name,
        position: {
          x: token.x,
          y: token.y,
        },
        size: {
          width: token.width,
          height: token.height,
        },
        actorId: token.actorId,
        disposition: this.getDispositionName(token.disposition),
        hidden: token.hidden,
        hasImage: !!token.img,
      }));
  }

  private createTokenSummary(tokens: any[], includeHidden: boolean): any {
    const visibleTokens = includeHidden ? tokens : tokens.filter(t => !t.hidden);

    const summary = {
      total: visibleTokens.length,
      byDisposition: {
        friendly: 0,
        neutral: 0,
        hostile: 0,
        unknown: 0,
      },
      hasActors: 0,
      withoutActors: 0,
    };

    visibleTokens.forEach(token => {
      // Count by disposition
      const disposition = this.getDispositionName(token.disposition);
      if (disposition in summary.byDisposition) {
        summary.byDisposition[disposition as keyof typeof summary.byDisposition]++;
      } else {
        summary.byDisposition.unknown++;
      }

      // Count actor association
      if (token.actorId) {
        summary.hasActors++;
      } else {
        summary.withoutActors++;
      }
    });

    return summary;
  }

  private formatWorldResponse(worldData: any): any {
    return {
      id: worldData.id,
      title: worldData.title,
      system: {
        id: worldData.system,
        version: worldData.systemVersion,
      },
      foundry: {
        version: worldData.foundryVersion,
      },
      users: {
        total: worldData.users?.length || 0,
        active: worldData.users?.filter((u: any) => u.active).length || 0,
        gms: worldData.users?.filter((u: any) => u.isGM).length || 0,
        players: worldData.users?.filter((u: any) => !u.isGM).length || 0,
      },
      activeUsers:
        worldData.users
          ?.filter((u: any) => u.active)
          .map((u: any) => ({
            id: u.id,
            name: u.name,
            isGM: u.isGM,
          })) || [],
    };
  }

  private getDispositionName(disposition: number): string {
    switch (disposition) {
      case -1:
        return 'hostile';
      case 0:
        return 'neutral';
      case 1:
        return 'friendly';
      default:
        return 'unknown';
    }
  }

  private truncateText(text: string, maxLength: number): string {
    if (!text || text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + '...';
  }
}
