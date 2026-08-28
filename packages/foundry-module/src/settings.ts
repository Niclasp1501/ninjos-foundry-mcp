import { MODULE_ID, DEFAULT_CONFIG } from './constants.js';
import type { BridgeConfig } from './socket-bridge.js';

export class ModuleSettings {
  private moduleId: string = MODULE_ID;

  /**
   * Register all module settings with Foundry
   */
  registerSettings(): void {
    // ============================================================================
    // SETTINGS MENU - Detailed Configuration Dialog
    // ============================================================================

    // Enhanced Creature Index submenu
    (game.settings as any).registerMenu(this.moduleId, 'enhancedIndexMenu', {
      name: 'foundry-mcp-bridge.menus.enhancedIndexMenu.name',
      label: 'foundry-mcp-bridge.menus.enhancedIndexMenu.label',
      hint: 'foundry-mcp-bridge.menus.enhancedIndexMenu.hint',
      icon: 'fas fa-search-plus',
      type: class extends FormApplication {
        static get defaultOptions() {
          return foundry.utils.mergeObject(super.defaultOptions, {
            title: game.i18n.localize(`${MODULE_ID}.index.window`),
            template: `modules/${MODULE_ID}/templates/enhanced-index-menu.html`,
            width: 560,
            height: 'auto',
            resizable: true, // NINJO: vorher fest, dadurch wurde der Inhalt abgeschnitten
            closeOnSubmit: false,
          } as any);
        }

        getData(): any {
          return {
            enableEnhancedCreatureIndex: game.settings.get(
              MODULE_ID,
              'enableEnhancedCreatureIndex'
            ),
            autoRebuildIndex: game.settings.get(MODULE_ID, 'autoRebuildIndex'),
          };
        }

        activateListeners(html: JQuery) {
          super.activateListeners(html);
          html.find('.rebuild-index-btn').click(() => {
            const bridge = (globalThis as any).foundryMCPBridge;
            if (bridge?.dataAccess?.rebuildEnhancedCreatureIndex) {
              ui.notifications?.info('Rebuilding enhanced creature index...');
              bridge.dataAccess.rebuildEnhancedCreatureIndex();
            }
          });
        }

        async _updateObject(_event: Event, formData: any) {
          await game.settings.set(
            MODULE_ID,
            'enableEnhancedCreatureIndex',
            formData.enableEnhancedCreatureIndex
          );
          await game.settings.set(MODULE_ID, 'autoRebuildIndex', formData.autoRebuildIndex);
        }
      },
      restricted: true,
    });

    // NINJO-ERWEITERUNG: Kompendien zum Anhaken freigeben
    (game.settings as any).registerMenu(this.moduleId, 'compendiumAccessMenu', {
      name: 'foundry-mcp-bridge.compendiumAccess.name',
      label: 'foundry-mcp-bridge.compendiumAccess.label',
      hint: 'foundry-mcp-bridge.compendiumAccess.hint',
      icon: 'fas fa-book-open',
      type: class extends FormApplication {
        static get defaultOptions() {
          return foundry.utils.mergeObject(super.defaultOptions, {
            title: game.i18n.localize(`${MODULE_ID}.compendiumAccess.window`),
            template: `modules/${MODULE_ID}/templates/compendium-access.html`,
            width: 620,
            height: 'auto',
            resizable: true,
            closeOnSubmit: true,
          } as any);
        }

        getData(): any {
          const roh = (game.settings.get(MODULE_ID, 'writableCompendiums') as string) || '';
          const freigegeben = roh
            .split(/[,\n;]/)
            .map((e: string) => e.trim())
            .filter(Boolean);

          const packs = Array.from((game.packs as any) ?? []) as any[];

          const gruppen: Record<string, any> = {
            world: {
              label: game.i18n.localize(`${MODULE_ID}.compendiumAccess.groupWorld`),
              packs: [],
            },
            module: {
              label: game.i18n.localize(`${MODULE_ID}.compendiumAccess.groupModule`),
              packs: [],
            },
            system: {
              label: game.i18n.localize(`${MODULE_ID}.compendiumAccess.groupSystem`),
              packs: [],
            },
          };

          for (const p of packs) {
            const art = (p.metadata?.packageType as string) || 'module';
            const ziel = gruppen[art] ?? gruppen.module;
            const id = p.collection as string;
            ziel.packs.push({
              id,
              label: p.metadata?.label ?? p.title ?? id,
              type: p.documentName,
              entries: p.index?.size ?? 0,
              locked: p.locked === true,
              selected:
                freigegeben.includes(id) || freigegeben.includes(p.metadata?.packageName as string),
            });
          }

          for (const g of Object.values(gruppen) as any[]) {
            g.packs.sort((a: any, b: any) => a.label.localeCompare(b.label));
          }

          return {
            allowAllUnlocked: freigegeben.length === 0,
            groups: Object.values(gruppen).filter((g: any) => g.packs.length),
          };
        }

        async _updateObject(_event: Event, formData: any): Promise<void> {
          // Alles erlauben heisst: leere Liste, dann zaehlt nur die Sperre
          if (formData.__allowAllUnlocked) {
            await game.settings.set(MODULE_ID, 'writableCompendiums', '');
            ui.notifications?.info(game.i18n.localize(`${MODULE_ID}.compendiumAccess.savedAll`));
            return;
          }

          const gewaehlt = Object.entries(formData)
            .filter(([k, v]) => k.startsWith('pack.') && v === true)
            .map(([k]) => k.slice('pack.'.length));

          await game.settings.set(MODULE_ID, 'writableCompendiums', gewaehlt.join(', '));
          ui.notifications?.info(
            game.i18n.format(`${MODULE_ID}.compendiumAccess.savedSome`, {
              count: gewaehlt.length,
            })
          );
        }
      },
      restricted: true,
    });

    // Map Generation Service submenu
    (game.settings as any).registerMenu(this.moduleId, 'mapGenerationSettings', {
      name: 'foundry-mcp-bridge.menus.mapGenerationSettings.name',
      label: 'foundry-mcp-bridge.menus.mapGenerationSettings.label',
      hint: 'foundry-mcp-bridge.menus.mapGenerationSettings.hint',
      icon: 'fas fa-cogs',
      type: class extends FormApplication {
        static get defaultOptions() {
          return foundry.utils.mergeObject(super.defaultOptions, {
            title: game.i18n.localize(`${MODULE_ID}.mapgen.window`),
            template: `modules/${MODULE_ID}/templates/comfyui-settings.html`,
            width: 560,
            height: 'auto',
            resizable: true, // NINJO: vorher fest, dadurch wurde der Inhalt abgeschnitten
            closeOnSubmit: false,
          } as any);
        }

        getData(): any {
          return {
            autoStartService: game.settings.get(MODULE_ID, 'mapGenAutoStart') ?? false,
            // NINJO: vorher "|| true". In JavaScript ergibt false || true = true,
            // also wurde ein gespeichertes Aus beim Anzeigen wieder zu An und beim
            // Speichern zurueckgeschrieben. Der Haken liess sich nicht entfernen.
            mapGenQuality: game.settings.get(MODULE_ID, 'mapGenQuality') ?? 'low',
            connectionStatus: this.getConnectionStatus(),
            connectionStatusText: this.getConnectionStatusText(),
          };
        }

        getConnectionStatus(): string {
          const bridge = (globalThis as any).foundryMCPBridge;
          return bridge?.comfyuiManager ? 'unknown' : 'stopped';
        }

        getConnectionStatusText(): string {
          return 'Click "Check Status" to verify service';
        }

        activateListeners(html: JQuery) {
          super.activateListeners(html);

          // Service control buttons
          html.find('#check-status-btn').click(async () => {
            await this.checkServiceStatus();
          });

          html.find('#start-service-btn').click(async () => {
            await this.startService();
          });

          html.find('#stop-service-btn').click(async () => {
            await this.stopService();
          });
        }

        async checkServiceStatus() {
          const bridge = (globalThis as any).foundryMCPBridge;
          if (bridge?.comfyuiManager) {
            try {
              const status = await bridge.comfyuiManager.checkStatus();
              this.updateStatusDisplay(status);
            } catch (error) {
              console.error('Status check failed:', error);
              this.updateStatusDisplay({ status: 'error', message: 'Status check failed' });
            }
          }
        }

        async startService() {
          const bridge = (globalThis as any).foundryMCPBridge;
          if (bridge?.comfyuiManager) {
            try {
              const result = await bridge.comfyuiManager.startService();
              this.updateStatusDisplay(result);
            } catch (error) {
              console.error('Service start failed:', error);
              this.updateStatusDisplay({ status: 'error', message: 'Service start failed' });
            }
          }
        }

        async stopService() {
          const bridge = (globalThis as any).foundryMCPBridge;
          if (bridge?.comfyuiManager) {
            try {
              const result = await bridge.comfyuiManager.stopService();
              this.updateStatusDisplay(result);
            } catch (error) {
              console.error('Service stop failed:', error);
              this.updateStatusDisplay({ status: 'error', message: 'Service stop failed' });
            }
          }
        }

        updateStatusDisplay(status: any) {
          const statusElement = this.element.find('#connection-status');
          const statusText = this.element.find('#status-text');

          // Remove all status classes
          statusElement.removeClass('running stopped starting error unknown');

          // Add current status class
          statusElement.addClass(status.status);
          statusText.text(this.getStatusText(status.status));
        }

        getStatusText(status: string): string {
          const statusMap: { [key: string]: string } = {
            running: 'Service Running',
            stopped: 'Service Stopped',
            starting: 'Service Starting...',
            error: 'Service Error',
            unknown: 'Status Unknown',
          };
          return statusMap[status] || 'Unknown';
        }

        async _updateObject(_event: Event, formData: any) {
          await game.settings.set(MODULE_ID, 'mapGenAutoStart', formData.autoStartService);
          await game.settings.set(MODULE_ID, 'mapGenQuality', formData.mapGenQuality);
          ui.notifications?.info('Map generation service settings saved successfully');
        }
      },
      restricted: true,
    });

    // ============================================================================
    // SECTION 1: BASIC SETTINGS
    // ============================================================================

    game.settings.register(this.moduleId, 'enabled', {
      name: 'foundry-mcp-bridge.settings.enabled.name',
      hint: 'foundry-mcp-bridge.settings.enabled.hint',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
      onChange: this.onEnabledChange.bind(this),
    });

    game.settings.register(this.moduleId, 'connectionType', {
      name: 'foundry-mcp-bridge.settings.connectionType.name',
      hint: 'foundry-mcp-bridge.settings.connectionType.hint',
      scope: 'world',
      config: true,
      type: String,
      choices: {
        auto: 'foundry-mcp-bridge.settings.connectionType.choices.auto',
        webrtc: 'foundry-mcp-bridge.settings.connectionType.choices.webrtc',
        websocket: 'foundry-mcp-bridge.settings.connectionType.choices.websocket',
      },
      default: 'auto',
      onChange: this.onConnectionChange.bind(this),
    });

    game.settings.register(this.moduleId, 'serverHost', {
      name: 'foundry-mcp-bridge.settings.serverHost.name',
      hint: 'foundry-mcp-bridge.settings.serverHost.hint',
      scope: 'world',
      config: true,
      type: String,
      default: DEFAULT_CONFIG.MCP_HOST,
      onChange: this.onConnectionChange.bind(this),
    });

    game.settings.register(this.moduleId, 'serverPort', {
      name: 'foundry-mcp-bridge.settings.serverPort.name',
      hint: 'foundry-mcp-bridge.settings.serverPort.hint',
      scope: 'world',
      config: false,
      type: Number,
      default: DEFAULT_CONFIG.MCP_PORT,
      onChange: this.onConnectionChange.bind(this),
    });

    // ============================================================================
    // SECTION 2: WRITE PERMISSIONS
    // ============================================================================

    game.settings.register(this.moduleId, 'allowWriteOperations', {
      name: 'foundry-mcp-bridge.settings.allowWriteOperations.name',
      hint: 'foundry-mcp-bridge.settings.allowWriteOperations.hint',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
    });

    // ============================================================================
    // NINJO-ERWEITERUNG: Rechte je Dokumentart
    //
    // Statt eines einzigen Schalters fuer alles steht jede Dokumentart einzeln
    // zur Wahl, in drei Stufen. Loeschen ist ueberall ab Werk aus, weil es sich
    // als einzige Aktion nicht rueckgaengig machen laesst. Wer der KI das
    // Aufraeumen erlauben will, gibt gezielt frei, was sie anfassen darf.
    //
    // Der uebergeordnete Schalter "Allow Write Operations" bleibt vorgeschaltet:
    // ist er aus, aendert die KI gar nichts, unabhaengig von diesen Stufen.
    // ============================================================================

    game.settings.register(this.moduleId, 'permScenes', {
      name: 'foundry-mcp-bridge.settings.permScenes.name',
      hint: 'foundry-mcp-bridge.settings.permScenes.hint',
      scope: 'world',
      config: true,
      type: String,
      choices: {
        read: 'foundry-mcp-bridge.settings.permScenes.choices.read',
        write: 'foundry-mcp-bridge.settings.permScenes.choices.write',
        full: 'foundry-mcp-bridge.settings.permScenes.choices.full',
      },
      default: 'write',
    });

    game.settings.register(this.moduleId, 'permPlaylists', {
      name: 'foundry-mcp-bridge.settings.permPlaylists.name',
      hint: 'foundry-mcp-bridge.settings.permPlaylists.hint',
      scope: 'world',
      config: true,
      type: String,
      choices: {
        read: 'foundry-mcp-bridge.settings.permPlaylists.choices.read',
        write: 'foundry-mcp-bridge.settings.permPlaylists.choices.write',
        full: 'foundry-mcp-bridge.settings.permPlaylists.choices.full',
      },
      default: 'write',
    });

    game.settings.register(this.moduleId, 'permJournals', {
      name: 'foundry-mcp-bridge.settings.permJournals.name',
      hint: 'foundry-mcp-bridge.settings.permJournals.hint',
      scope: 'world',
      config: true,
      type: String,
      choices: {
        read: 'foundry-mcp-bridge.settings.permJournals.choices.read',
        write: 'foundry-mcp-bridge.settings.permJournals.choices.write',
        full: 'foundry-mcp-bridge.settings.permJournals.choices.full',
      },
      default: 'write',
    });

    game.settings.register(this.moduleId, 'permRollTables', {
      name: 'foundry-mcp-bridge.settings.permRollTables.name',
      hint: 'foundry-mcp-bridge.settings.permRollTables.hint',
      scope: 'world',
      config: true,
      type: String,
      choices: {
        read: 'foundry-mcp-bridge.settings.permRollTables.choices.read',
        write: 'foundry-mcp-bridge.settings.permRollTables.choices.write',
        full: 'foundry-mcp-bridge.settings.permRollTables.choices.full',
      },
      default: 'write',
    });

    game.settings.register(this.moduleId, 'permActors', {
      name: 'foundry-mcp-bridge.settings.permActors.name',
      hint: 'foundry-mcp-bridge.settings.permActors.hint',
      scope: 'world',
      config: true,
      type: String,
      choices: {
        read: 'foundry-mcp-bridge.settings.permActors.choices.read',
        write: 'foundry-mcp-bridge.settings.permActors.choices.write',
        full: 'foundry-mcp-bridge.settings.permActors.choices.full',
      },
      default: 'write',
    });

    game.settings.register(this.moduleId, 'writableCompendiums', {
      name: 'foundry-mcp-bridge.settings.writableCompendiums.name',
      hint: 'foundry-mcp-bridge.settings.writableCompendiums.hint',
      scope: 'world',
      config: false, // NINJO: wird ueber das Menue "Kompendien freigeben" gepflegt
      type: String,
      default: '',
    });

    game.settings.register(this.moduleId, 'permCompendiums', {
      name: 'foundry-mcp-bridge.settings.permCompendiums.name',
      hint: 'foundry-mcp-bridge.settings.permCompendiums.hint',
      scope: 'world',
      config: true,
      type: String,
      choices: {
        read: 'foundry-mcp-bridge.settings.permCompendiums.choices.read',
        write: 'foundry-mcp-bridge.settings.permCompendiums.choices.write',
        full: 'foundry-mcp-bridge.settings.permCompendiums.choices.full',
      },
      default: 'write',
    });

    game.settings.register(this.moduleId, 'permFolders', {
      name: 'foundry-mcp-bridge.settings.permFolders.name',
      hint: 'foundry-mcp-bridge.settings.permFolders.hint',
      scope: 'world',
      config: true,
      type: String,
      choices: {
        read: 'foundry-mcp-bridge.settings.permFolders.choices.read',
        write: 'foundry-mcp-bridge.settings.permFolders.choices.write',
        full: 'foundry-mcp-bridge.settings.permFolders.choices.full',
      },
      default: 'write',
    });

    // ============================================================================
    // SECTION 3: SAFETY CONTROLS - Limits on AI model's Actions
    // ============================================================================

    game.settings.register(this.moduleId, 'maxActorsPerRequest', {
      name: 'foundry-mcp-bridge.settings.maxActorsPerRequest.name',
      hint: 'foundry-mcp-bridge.settings.maxActorsPerRequest.hint',
      scope: 'world',
      config: true,
      type: Number,
      default: 10,
      range: {
        min: 1,
        max: 50,
        step: 1,
      },
    });

    // Removed 'enableWriteAuditLog' setting as it provides no rollback functionality
    // and only creates log entries without user-actionable features

    // Enhanced Creature Index settings (configured via submenu only)
    game.settings.register(this.moduleId, 'enableEnhancedCreatureIndex', {
      scope: 'world',
      config: false, // Hidden from main config, accessible via submenu only
      type: Boolean,
      default: true,
    });

    game.settings.register(this.moduleId, 'autoRebuildIndex', {
      scope: 'world',
      config: false, // Hidden from main config, accessible via submenu only
      type: Boolean,
      default: true,
    });

    // Map Generation Service settings (configured via submenu only)
    // ComfyUI always runs on localhost:31411 (same machine as MCP server)
    game.settings.register(this.moduleId, 'mapGenAutoStart', {
      name: 'foundry-mcp-bridge.settings.mapGenAutoStart.name',
      scope: 'world',
      config: true, // NINJO: im Hauptmenue sichtbar, nicht nur im Untermenue
      type: Boolean,
      default: false, // NINJO: Kartengenerator startet nur auf ausdruecklichen Wunsch
    });

    game.settings.register(this.moduleId, 'mapGenQuality', {
      name: 'foundry-mcp-bridge.settings.mapGenQuality.name',
      hint: 'foundry-mcp-bridge.settings.mapGenQuality.hint',
      scope: 'world',
      config: false, // Hidden from main config, accessible via submenu only
      type: String,
      choices: {
        low: 'foundry-mcp-bridge.settings.mapGenQuality.choices.low',
        medium: 'foundry-mcp-bridge.settings.mapGenQuality.choices.medium',
        high: 'foundry-mcp-bridge.settings.mapGenQuality.choices.high',
      },
      default: 'low',
    });

    // ============================================================================
    // SECTION 4: CONNECTION BEHAVIOR
    // ============================================================================

    game.settings.register(this.moduleId, 'enableNotifications', {
      name: 'foundry-mcp-bridge.settings.enableNotifications.name',
      hint: 'foundry-mcp-bridge.settings.enableNotifications.hint',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
    });

    game.settings.register(this.moduleId, 'autoReconnectEnabled', {
      name: 'foundry-mcp-bridge.settings.autoReconnectEnabled.name',
      hint: 'foundry-mcp-bridge.settings.autoReconnectEnabled.hint',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
    });

    game.settings.register(this.moduleId, 'heartbeatInterval', {
      name: 'foundry-mcp-bridge.settings.heartbeatInterval.name',
      hint: 'foundry-mcp-bridge.settings.heartbeatInterval.hint',
      scope: 'world',
      config: true,
      type: Number,
      default: 30,
      range: {
        min: 10,
        max: 120,
        step: 5,
      },
    });

    // Non-configurable settings for internal state
    game.settings.register(this.moduleId, 'lastConnectionState', {
      scope: 'world',
      config: false,
      type: String,
      default: 'disconnected',
    });

    game.settings.register(this.moduleId, 'lastActivity', {
      scope: 'world',
      config: false,
      type: String,
      default: '',
    });

    // Track when we last showed the MCP server notification to avoid spam
    game.settings.register(this.moduleId, 'lastMCPServerNotification', {
      scope: 'world',
      config: false,
      type: String,
      default: '',
    });

    // Roll state storage for persistent roll button states
    game.settings.register(this.moduleId, 'rollStates', {
      scope: 'world',
      config: false,
      type: Object,
      default: {},
      onChange: this.onRollStatesChanged.bind(this),
    });

    // Button to message ID mapping for ChatMessage updates
    game.settings.register(this.moduleId, 'buttonMessageMap', {
      scope: 'world',
      config: false,
      type: Object,
      default: {},
    });
  }

  /**
   * Handle roll states setting changes - fires on all clients for world-scoped settings
   */
  private onRollStatesChanged(_newValue: any): void {
    // No action needed - ChatMessage.update() handles state synchronization automatically
  }

  /**
   * Update connection status display in settings
   */
  updateConnectionStatusDisplay(connected: boolean, _toolCount: number): void {
    try {
      const statusText = connected
        ? game.i18n.localize(`${this.moduleId}.status.connected`)
        : game.i18n.localize(`${this.moduleId}.status.disconnected`);

      /* NINJO: Hier stand der Hinweistext der Einstellung als Grundlage. Seit die
       * Beschriftungen ueber die Sprachdateien laufen, steht dort aber der
       * Schluessel und nicht der uebersetzte Text. Das Anhaengen des Status machte
       * ihn unaufloesbar, im Menue erschien "foundry-mcp-bridge.settings.enabled.hint".
       * Deshalb wird der Grundtext jetzt ausdruecklich uebersetzt. */
      const basis = game.i18n.localize(`${this.moduleId}.settings.enabled.hint`);
      const label = game.i18n.localize(`${this.moduleId}.status.label`);

      const enabledSetting = (game.settings as any).settings.get(`${this.moduleId}.enabled`);
      if (enabledSetting) {
        enabledSetting.hint = `${basis} | ${label}: ${statusText}`;
      }
    } catch (error) {
      console.warn(`[${this.moduleId}] Failed to update status display:`, error);
    }
  }

  /**
   * Get current bridge configuration from settings
   */
  getBridgeConfig(): BridgeConfig {
    const connectionType = this.getSetting('connectionType');

    return {
      enabled: this.getSetting('enabled'),
      serverHost: this.getSetting('serverHost'),
      serverPort: this.getSetting('serverPort'),
      namespace: '/foundry-mcp', // Fixed namespace - no user configuration needed
      reconnectAttempts: DEFAULT_CONFIG.RECONNECT_ATTEMPTS, // Use sensible default
      reconnectDelay: DEFAULT_CONFIG.RECONNECT_DELAY, // Use sensible default
      connectionTimeout: DEFAULT_CONFIG.CONNECTION_TIMEOUT, // Use sensible default
      debugLogging: false, // Always false - use browser console for debugging
      connectionType: connectionType as 'auto' | 'webrtc' | 'websocket',
    };
  }

  /**
   * Get a specific setting value
   */
  getSetting(key: string): any {
    return game.settings.get(this.moduleId, key);
  }

  /**
   * Set a specific setting value
   */
  async setSetting(key: string, value: any): Promise<any> {
    return game.settings.set(this.moduleId, key, value);
  }

  /**
   * Get all settings as an object
   */
  getAllSettings(): Record<string, any> {
    const settingKeys = [
      // Basic Settings
      'enabled',
      'serverHost',
      'serverPort',
      'connectionType',
      // Permissions
      'allowWriteOperations',
      // Safety Controls
      'maxActorsPerRequest',
      // Enhanced Creature Index
      'enableEnhancedCreatureIndex',
      'autoRebuildIndex',
      // Connection Behavior
      'enableNotifications',
      'autoReconnectEnabled',
      'heartbeatInterval',
    ];

    const settings: Record<string, any> = {};
    for (const key of settingKeys) {
      settings[key] = this.getSetting(key);
    }

    return settings;
  }

  /**
   * Validate settings for consistency
   */
  validateSettings(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    const host = this.getSetting('serverHost');
    if (!host || typeof host !== 'string' || host.trim().length === 0) {
      errors.push('Server host cannot be empty');
    }

    const port = this.getSetting('serverPort');
    if (!port || typeof port !== 'number' || port < 1024 || port > 65535) {
      errors.push('Server port must be between 1024 and 65535');
    }

    const maxActors = this.getSetting('maxActorsPerRequest');
    if (!maxActors || typeof maxActors !== 'number' || maxActors < 1 || maxActors > 10) {
      errors.push('Max actors per request must be between 1 and 10');
    }

    const heartbeat = this.getSetting('heartbeatInterval');
    if (!heartbeat || typeof heartbeat !== 'number' || heartbeat < 10 || heartbeat > 120) {
      errors.push('Heartbeat interval must be between 10 and 120 seconds');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Handle enabled setting change
   */
  private onEnabledChange(enabled: boolean): void {
    // Trigger bridge state change through global event
    if (window.foundryMCPBridge) {
      if (enabled) {
        window.foundryMCPBridge.start?.();
      } else {
        window.foundryMCPBridge.stop?.();
      }
    }
  }

  /**
   * Handle connection setting changes
   */
  private onConnectionChange(): void {
    // If bridge is running, restart it with new settings
    if (window.foundryMCPBridge && this.getSetting('enabled')) {
      window.foundryMCPBridge.restart?.();
    }
  }

  /**
   * Create settings migration for version updates
   */
  /**
   * Get write operation permissions
   */
  getWritePermissions(): {
    allowWriteOperations: boolean;
    maxActorsPerRequest: number;
  } {
    return {
      allowWriteOperations: this.getSetting('allowWriteOperations'),
      maxActorsPerRequest: this.getSetting('maxActorsPerRequest'),
    };
  }

  /**
   * Check if AI model is allowed to perform write operations
   */
  isWriteOperationAllowed(_operation?: string): boolean {
    // Simplified - single permission covers all write operations
    return this.getSetting('allowWriteOperations');
  }

  migrateSettings(_fromVersion: string, _toVersion: string): void {
    // Add migration logic here for future versions
    // For now, no migrations needed as this is initial version
  }

  /**
   * Reset all settings to defaults
   */
  async resetToDefaults(): Promise<void> {
    const settingKeys = [
      // Basic Settings
      'enabled',
      'serverHost',
      'serverPort',
      'connectionType',
      // Permissions
      'allowWriteOperations',
      // Safety Controls
      'maxActorsPerRequest',
      // Enhanced Creature Index
      'enableEnhancedCreatureIndex',
      'autoRebuildIndex',
      // Connection Behavior
      'enableNotifications',
      'autoReconnectEnabled',
      'heartbeatInterval',
    ];

    for (const key of settingKeys) {
      // Get the default value from the setting registration
      const setting = (game.settings as any).settings.get(`${this.moduleId}.${key}`);
      if (setting && 'default' in setting) {
        await this.setSetting(key, setting.default);
      }
    }

    ui.notifications.info('MCP Bridge settings have been reset to defaults');
  }
}
