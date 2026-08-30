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
      name: 'ninjos-foundry-mcp.menus.enhancedIndexMenu.name',
      label: 'ninjos-foundry-mcp.menus.enhancedIndexMenu.label',
      hint: 'ninjos-foundry-mcp.menus.enhancedIndexMenu.hint',
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
      name: 'ninjos-foundry-mcp.compendiumAccess.name',
      label: 'ninjos-foundry-mcp.compendiumAccess.label',
      hint: 'ninjos-foundry-mcp.compendiumAccess.hint',
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

          // NINJO: Ein Block je Herkunft, und bei Modulen je Modul.
          //
          // Vorher gab es nur drei Bloecke - Welt, Module, System. Alle
          // Modul-Kompendien lagen in einem Topf und dort nach Beschriftung
          // sortiert, wodurch "BBMM Journal", "Bestiarium" aus ninjo-kompendium
          // und "Klassen" aus dnd-players-handbook durcheinander standen. Wer ein
          // bestimmtes Modul freigeben will, sucht sich die Eintraege dann
          // zusammen. Jetzt traegt jedes Modul seinen eigenen Block mit seinem
          // Titel.
          const gruppen = new Map<string, any>();

          const gruppeHolen = (schluessel: string, beschriftung: string, ordnung: number) => {
            if (!gruppen.has(schluessel)) {
              gruppen.set(schluessel, { label: beschriftung, ordnung, packs: [] });
            }
            return gruppen.get(schluessel);
          };

          for (const p of packs) {
            const art = (p.metadata?.packageType as string) || 'module';
            const herkunft = (p.metadata?.packageName as string) || '';
            const id = p.collection as string;

            let ziel;
            if (art === 'world') {
              ziel = gruppeHolen(
                'world',
                game.i18n.localize(`${MODULE_ID}.compendiumAccess.groupWorld`),
                0
              );
            } else if (art === 'system') {
              ziel = gruppeHolen(
                'system',
                game.i18n.localize(`${MODULE_ID}.compendiumAccess.groupSystem`),
                2
              );
            } else {
              // Der Titel des Moduls statt seiner Kennung: "Ninjos Kompendium"
              // liest sich besser als "ninjo-kompendium". Ist das Modul nicht
              // auffindbar, bleibt die Kennung als Notnagel.
              const modul = (game.modules as any)?.get?.(herkunft);
              const titel = modul?.title || herkunft || id;
              ziel = gruppeHolen(`module:${herkunft}`, titel, 1);
            }

            ziel.packs.push({
              id,
              label: p.metadata?.label ?? p.title ?? id,
              type: p.documentName,
              entries: p.index?.size ?? 0,
              locked: p.locked === true,
              selected: freigegeben.includes(id) || freigegeben.includes(herkunft),
            });
          }

          const sortiert = Array.from(gruppen.values())
            .filter((g: any) => g.packs.length)
            // Erst die eigene Welt, dann die Module nach Titel, zuletzt das
            // Spielsystem. Was einem selbst gehoert, steht oben.
            .sort((a: any, b: any) =>
              a.ordnung !== b.ordnung
                ? a.ordnung - b.ordnung
                : String(a.label).localeCompare(String(b.label))
            );

          for (const g of sortiert) {
            g.packs.sort((a: any, b: any) => String(a.label).localeCompare(String(b.label)));
          }

          return {
            allowAllUnlocked: freigegeben.length === 0,
            groups: sortiert,
          };
        }

        // NINJO: Die beiden Angaben schliessen einander aus, das Formular liess
        // sie aber gleichzeitig setzen. Wer unten Kompendien anhakte und den
        // Haken oben stehen liess, verlor seine Auswahl beim Speichern
        // kommentarlos - _updateObject sieht "alles erlauben" zuerst und kehrt
        // zurueck, bevor es die Auswahl ueberhaupt liest. Beim naechsten Oeffnen
        // war nichts angehakt, ohne dass irgendwo stand, warum.
        //
        // Deshalb hier: Beides gleichzeitig geht nicht mehr. Wer ein Kompendium
        // anhakt, meint eine Auswahl; wer oben anhakt, meint alle.
        activateListeners(html: JQuery) {
          super.activateListeners(html);

          const alle = html.find('input[name="__allowAllUnlocked"]');
          const packs = html.find('input[name^="pack."]');
          const liste = html.find('.mcp-pack-list');

          const dimmen = () => liste.toggleClass('mcp-dimmed', alle.prop('checked') === true);

          alle.on('change', () => {
            if (alle.prop('checked')) packs.prop('checked', false);
            dimmen();
          });

          packs.on('change', function (this: HTMLInputElement) {
            if (this.checked) alle.prop('checked', false);
            dimmen();
          });

          dimmen();
        }

        async _updateObject(_event: Event, formData: any): Promise<void> {
          // NINJO: Die Haken heissen in der Vorlage "pack.<kennung>", und eine
          // Pack-Kennung enthaelt selbst einen Punkt ("ninjo-kompendium.presets").
          // Foundry entfaltet Feldnamen mit Punkten zu verschachtelten Objekten,
          // bevor diese Methode sie sieht - hier kommt also
          //
          //   { pack: { 'ninjo-kompendium': { presets: true } } }
          //
          // an und nicht der flache Schluessel. Die frueher hier stehende Suche
          // nach Schluesseln, die mit "pack." beginnen, fand deshalb nie etwas:
          // Es wurde stets eine leere Liste gespeichert, und beim naechsten
          // Oeffnen war jeder Haken wieder weg. Schlimmer noch, eine leere Liste
          // bedeutet "jedes entsperrte Kompendium ist freigegeben" - die
          // Einschraenkung fiel damit still zurueck.
          //
          // flattenObject macht das Entfalten rueckgaengig. Es ist unschaedlich,
          // falls Foundry die Daten eines Tages flach uebergibt.
          const flach = (foundry as any).utils.flattenObject(formData) as Record<string, unknown>;

          const gewaehlt = Object.entries(flach)
            .filter(([k, v]) => k.startsWith('pack.') && v === true)
            .map(([k]) => k.slice('pack.'.length));

          // Eine getroffene Auswahl sticht "alles erlauben". Frueher stand die
          // Pruefung auf __allowAllUnlocked ganz oben und kehrte sofort zurueck -
          // wer unten anhakte und den Haken oben stehen liess, verlor die Auswahl
          // kommentarlos. Umgekehrt ist es richtig: Wer einzelne Kompendien
          // benennt, hat sich etwas dabei gedacht.
          if (!gewaehlt.length && formData?.__allowAllUnlocked === true) {
            await game.settings.set(MODULE_ID, 'writableCompendiums', '');
            ui.notifications?.info(game.i18n.localize(`${MODULE_ID}.compendiumAccess.savedAll`));
            return;
          }

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
      name: 'ninjos-foundry-mcp.menus.mapGenerationSettings.name',
      label: 'ninjos-foundry-mcp.menus.mapGenerationSettings.label',
      hint: 'ninjos-foundry-mcp.menus.mapGenerationSettings.hint',
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
      name: 'ninjos-foundry-mcp.settings.enabled.name',
      hint: 'ninjos-foundry-mcp.settings.enabled.hint',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
      onChange: this.onEnabledChange.bind(this),
    });

    game.settings.register(this.moduleId, 'connectionType', {
      name: 'ninjos-foundry-mcp.settings.connectionType.name',
      hint: 'ninjos-foundry-mcp.settings.connectionType.hint',
      scope: 'world',
      config: true,
      type: String,
      choices: {
        auto: 'ninjos-foundry-mcp.settings.connectionType.choices.auto',
        webrtc: 'ninjos-foundry-mcp.settings.connectionType.choices.webrtc',
        websocket: 'ninjos-foundry-mcp.settings.connectionType.choices.websocket',
      },
      default: 'auto',
      onChange: this.onConnectionChange.bind(this),
    });

    game.settings.register(this.moduleId, 'serverHost', {
      name: 'ninjos-foundry-mcp.settings.serverHost.name',
      hint: 'ninjos-foundry-mcp.settings.serverHost.hint',
      scope: 'world',
      config: true,
      type: String,
      default: DEFAULT_CONFIG.MCP_HOST,
      onChange: this.onConnectionChange.bind(this),
    });

    game.settings.register(this.moduleId, 'serverPort', {
      name: 'ninjos-foundry-mcp.settings.serverPort.name',
      hint: 'ninjos-foundry-mcp.settings.serverPort.hint',
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
      name: 'ninjos-foundry-mcp.settings.allowWriteOperations.name',
      hint: 'ninjos-foundry-mcp.settings.allowWriteOperations.hint',
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
      name: 'ninjos-foundry-mcp.settings.permScenes.name',
      hint: 'ninjos-foundry-mcp.settings.permScenes.hint',
      scope: 'world',
      config: true,
      type: String,
      choices: {
        read: 'ninjos-foundry-mcp.settings.permScenes.choices.read',
        write: 'ninjos-foundry-mcp.settings.permScenes.choices.write',
        full: 'ninjos-foundry-mcp.settings.permScenes.choices.full',
      },
      default: 'write',
    });

    game.settings.register(this.moduleId, 'permPlaylists', {
      name: 'ninjos-foundry-mcp.settings.permPlaylists.name',
      hint: 'ninjos-foundry-mcp.settings.permPlaylists.hint',
      scope: 'world',
      config: true,
      type: String,
      choices: {
        read: 'ninjos-foundry-mcp.settings.permPlaylists.choices.read',
        write: 'ninjos-foundry-mcp.settings.permPlaylists.choices.write',
        full: 'ninjos-foundry-mcp.settings.permPlaylists.choices.full',
      },
      default: 'write',
    });

    game.settings.register(this.moduleId, 'permJournals', {
      name: 'ninjos-foundry-mcp.settings.permJournals.name',
      hint: 'ninjos-foundry-mcp.settings.permJournals.hint',
      scope: 'world',
      config: true,
      type: String,
      choices: {
        read: 'ninjos-foundry-mcp.settings.permJournals.choices.read',
        write: 'ninjos-foundry-mcp.settings.permJournals.choices.write',
        full: 'ninjos-foundry-mcp.settings.permJournals.choices.full',
      },
      default: 'write',
    });

    game.settings.register(this.moduleId, 'permRollTables', {
      name: 'ninjos-foundry-mcp.settings.permRollTables.name',
      hint: 'ninjos-foundry-mcp.settings.permRollTables.hint',
      scope: 'world',
      config: true,
      type: String,
      choices: {
        read: 'ninjos-foundry-mcp.settings.permRollTables.choices.read',
        write: 'ninjos-foundry-mcp.settings.permRollTables.choices.write',
        full: 'ninjos-foundry-mcp.settings.permRollTables.choices.full',
      },
      default: 'write',
    });

    game.settings.register(this.moduleId, 'permActors', {
      name: 'ninjos-foundry-mcp.settings.permActors.name',
      hint: 'ninjos-foundry-mcp.settings.permActors.hint',
      scope: 'world',
      config: true,
      type: String,
      choices: {
        read: 'ninjos-foundry-mcp.settings.permActors.choices.read',
        write: 'ninjos-foundry-mcp.settings.permActors.choices.write',
        full: 'ninjos-foundry-mcp.settings.permActors.choices.full',
      },
      default: 'write',
    });

    game.settings.register(this.moduleId, 'writableCompendiums', {
      name: 'ninjos-foundry-mcp.settings.writableCompendiums.name',
      hint: 'ninjos-foundry-mcp.settings.writableCompendiums.hint',
      scope: 'world',
      config: false, // NINJO: wird ueber das Menue "Kompendien freigeben" gepflegt
      type: String,
      default: '',
    });

    game.settings.register(this.moduleId, 'permCompendiums', {
      name: 'ninjos-foundry-mcp.settings.permCompendiums.name',
      hint: 'ninjos-foundry-mcp.settings.permCompendiums.hint',
      scope: 'world',
      config: true,
      type: String,
      choices: {
        read: 'ninjos-foundry-mcp.settings.permCompendiums.choices.read',
        write: 'ninjos-foundry-mcp.settings.permCompendiums.choices.write',
        full: 'ninjos-foundry-mcp.settings.permCompendiums.choices.full',
      },
      default: 'write',
    });

    game.settings.register(this.moduleId, 'permFolders', {
      name: 'ninjos-foundry-mcp.settings.permFolders.name',
      hint: 'ninjos-foundry-mcp.settings.permFolders.hint',
      scope: 'world',
      config: true,
      type: String,
      choices: {
        read: 'ninjos-foundry-mcp.settings.permFolders.choices.read',
        write: 'ninjos-foundry-mcp.settings.permFolders.choices.write',
        full: 'ninjos-foundry-mcp.settings.permFolders.choices.full',
      },
      default: 'write',
    });

    // ============================================================================
    // SECTION 3: SAFETY CONTROLS - Limits on AI model's Actions
    // ============================================================================

    game.settings.register(this.moduleId, 'maxActorsPerRequest', {
      name: 'ninjos-foundry-mcp.settings.maxActorsPerRequest.name',
      hint: 'ninjos-foundry-mcp.settings.maxActorsPerRequest.hint',
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
      name: 'ninjos-foundry-mcp.settings.mapGenAutoStart.name',
      scope: 'world',
      config: true, // NINJO: im Hauptmenue sichtbar, nicht nur im Untermenue
      type: Boolean,
      default: false, // NINJO: Kartengenerator startet nur auf ausdruecklichen Wunsch
    });

    game.settings.register(this.moduleId, 'mapGenQuality', {
      name: 'ninjos-foundry-mcp.settings.mapGenQuality.name',
      hint: 'ninjos-foundry-mcp.settings.mapGenQuality.hint',
      scope: 'world',
      config: false, // Hidden from main config, accessible via submenu only
      type: String,
      choices: {
        low: 'ninjos-foundry-mcp.settings.mapGenQuality.choices.low',
        medium: 'ninjos-foundry-mcp.settings.mapGenQuality.choices.medium',
        high: 'ninjos-foundry-mcp.settings.mapGenQuality.choices.high',
      },
      default: 'low',
    });

    // ============================================================================
    // SECTION 4: CONNECTION BEHAVIOR
    // ============================================================================

    game.settings.register(this.moduleId, 'enableNotifications', {
      name: 'ninjos-foundry-mcp.settings.enableNotifications.name',
      hint: 'ninjos-foundry-mcp.settings.enableNotifications.hint',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
    });

    game.settings.register(this.moduleId, 'autoReconnectEnabled', {
      name: 'ninjos-foundry-mcp.settings.autoReconnectEnabled.name',
      hint: 'ninjos-foundry-mcp.settings.autoReconnectEnabled.hint',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
    });

    game.settings.register(this.moduleId, 'heartbeatInterval', {
      name: 'ninjos-foundry-mcp.settings.heartbeatInterval.name',
      hint: 'ninjos-foundry-mcp.settings.heartbeatInterval.hint',
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
       * ihn unaufloesbar, im Menue erschien "ninjos-foundry-mcp.settings.enabled.hint".
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

  /**
   * Übernimmt die Einstellungen aus der alten Modulkennung `foundry-mcp-bridge`.
   *
   * Warum das nötig ist: Foundry speichert Einstellungen unter dem Namensraum der
   * Modulkennung. Mit der Umbenennung auf `ninjos-foundry-mcp` sieht Foundry ein
   * neues Modul, und alles Gespeicherte bestehender Welten hängt weiter am alten
   * Namen — Serveradresse, Rechtematrix und die Liste der freigegebenen Kompendien
   * wären sonst weg und müssten von Hand neu gesetzt werden.
   *
   * Der Schritt ist bewusst so gebaut, dass er bei jedem Weltstart erneut laufen
   * darf: Er überschreibt keinen Wert, der unter der neuen Kennung bereits
   * gespeichert ist, und rührt den alten Namensraum nicht an.
   */
  async uebernehmeAlteEinstellungen(): Promise<number> {
    const ALTE_KENNUNG = 'foundry-mcp-bridge';

    // Nur der Spielleiter darf Welteinstellungen schreiben
    if (!game.user?.isGM) return 0;

    let uebernommen = 0;

    for (const bereich of ['world', 'client'] as const) {
      const speicher = (game.settings as any).storage?.get(bereich);
      if (!speicher) continue;

      // Der Weltspeicher ist eine Sammlung von Setting-Dokumenten, der
      // Client-Speicher ist der localStorage. Beide werden anders gelesen.
      let eintraege: Array<{ key: string; value: string }> = [];
      try {
        eintraege =
          bereich === 'world'
            ? Array.from(speicher as any).map((s: any) => ({ key: s.key, value: s.value }))
            : Object.keys(speicher)
                .filter(k => k.startsWith(`${ALTE_KENNUNG}.`))
                .map(k => ({ key: k, value: speicher.getItem(k) }));
      } catch (fehler) {
        console.warn(`[${MODULE_ID}] Speicher "${bereich}" nicht lesbar:`, fehler);
        continue;
      }

      for (const eintrag of eintraege) {
        if (!eintrag.key?.startsWith(`${ALTE_KENNUNG}.`)) continue;
        const schluessel = eintrag.key.slice(ALTE_KENNUNG.length + 1);

        // Nur übernehmen, was es unter der neuen Kennung auch wirklich gibt.
        // Verwaiste Schlüssel aus älteren Fassungen fallen damit weg.
        if (!(game.settings as any).settings.has(`${this.moduleId}.${schluessel}`)) continue;

        // Einen bereits gesetzten Wert nicht antasten
        if (this.hatGespeichertenWert(bereich, schluessel)) continue;

        try {
          // Foundry legt Werte als JSON ab. Ältere Stände speicherten manche
          // Zeichenketten roh, deshalb der Rückfall auf den unveränderten Wert.
          let wert: unknown;
          try {
            wert = JSON.parse(eintrag.value);
          } catch {
            wert = eintrag.value;
          }
          await game.settings.set(this.moduleId, schluessel, wert as any);
          uebernommen++;
        } catch (fehler) {
          console.warn(`[${MODULE_ID}] Einstellung "${schluessel}" nicht übernommen:`, fehler);
        }
      }
    }

    if (uebernommen > 0) {
      console.log(`[${MODULE_ID}] ${uebernommen} Einstellungen aus "${ALTE_KENNUNG}" übernommen`);
      ui.notifications?.info(
        game.i18n.format(`${MODULE_ID}.migration.uebernommen`, { anzahl: uebernommen })
      );
    }

    return uebernommen;
  }

  /**
   * Liegt für diesen Schlüssel unter der neuen Kennung schon ein Wert im Speicher?
   * Ein registrierter Standardwert zählt dabei nicht — nur wirklich Gespeichertes.
   */
  private hatGespeichertenWert(bereich: 'world' | 'client', schluessel: string): boolean {
    const speicher = (game.settings as any).storage?.get(bereich);
    if (!speicher) return false;

    const vollerSchluessel = `${this.moduleId}.${schluessel}`;
    try {
      return bereich === 'world'
        ? Array.from(speicher as any).some((s: any) => s.key === vollerSchluessel)
        : speicher.getItem(vollerSchluessel) !== null;
    } catch {
      return false;
    }
  }
}
