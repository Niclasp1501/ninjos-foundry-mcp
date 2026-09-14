/**
 * The content and the behaviour of the three settings windows.
 *
 * A controller knows nothing of ApplicationV2: it renders HTML text and
 * handles an action with a plain snapshot of the form. window-app.ts puts it
 * into a Foundry window. That split keeps every rule testable without a
 * browser: what is shown when a service is missing, what is stored, which
 * message appears.
 *
 * Every window shows the result of its action inside the window as well
 * (rule 5 of the interface principles), and reads a stored value back
 * before it reports success.
 */
import { readSetting } from '../../settings.js';
import { MODULE_ID } from '../../../common/constants.js';
import { checkedIf, disabledIf, escapeHtml, icon } from './html.js';
import { announce, messageText, reasonOf } from './messages.js';
import {
  buildReleaseView,
  packageTitle,
  readPacks,
  releaseListFrom,
  sameEntries,
  type PackInfo,
  type ReleaseGroup,
  type TitleOf,
} from './release-model.js';
import {
  interfaceService,
  type CompendiumReleaseService,
  type CreatureIndexService,
  type MapService,
  type MapServiceReport,
} from './services.js';
import { t } from './texts.js';

/** What the form holds when an action runs. */
export interface FormSnapshot {
  /** Checkboxes without data-list, by name. */
  flags: Record<string, boolean>;
  /** Selects and other inputs, by name. */
  values: Record<string, string>;
  /** Ticked checkboxes with data-list, their values by list name. */
  lists: Record<string, string[]>;
}

export interface WindowHost {
  /** Render the window again, if it is open. */
  refresh(): void;
  close(): void;
}

export interface WindowController {
  render(): string;
  action(name: string, form: FormSnapshot): Promise<void>;
  /** Called once, after the first render. */
  opened?(): void;
}

export interface SettingsAccess {
  /** undefined when the setting is not registered. */
  read(key: string): unknown;
  write(key: string, value: unknown): Promise<unknown>;
}

export const moduleSettings: SettingsAccess = {
  read: readSetting,
  write: (key, value) => game.settings.set(MODULE_ID, key, value),
};

export const EMPTY_FORM: FormSnapshot = { flags: {}, values: {}, lists: {} };

interface StatusLine {
  kind: 'info' | 'ok' | 'error';
  text: string;
}

const esc = escapeHtml;

function statusHtml(status: StatusLine | null): string {
  const kind = status?.kind ?? 'info';
  return `<p class="mcp-window__status mcp-window__status--${kind}" role="status" aria-live="polite">${esc(status?.text ?? '')}</p>`;
}

function unavailableHtml(what: string): string {
  return `<p class="mcp-window__unavailable">${icon('fa-circle-info')} ${esc(t('common.notAvailable', { what }))}</p>`;
}

function checkHtml(
  name: string,
  label: string,
  hint: string,
  checked: boolean,
  disabled: boolean
): string {
  return (
    `<label class="mcp-window__check"><input type="checkbox" name="${esc(name)}"${checkedIf(checked)}${disabledIf(disabled)}>` +
    `<span><strong>${esc(label)}</strong><small>${esc(hint)}</small></span></label>`
  );
}

function buttonHtml(action: string, iconName: string, label: string, disabled: boolean): string {
  return `<button type="button" data-action="${esc(action)}"${disabledIf(disabled)}>${icon(iconName)} ${esc(label)}</button>`;
}

function footerHtml(action: string, iconName: string, label: string, disabled: boolean): string {
  return (
    `<footer class="mcp-window__footer"><button type="button" class="mcp-window__primary" data-action="${esc(action)}"${disabledIf(disabled)}>` +
    `${icon(iconName)} ${esc(label)}</button></footer>`
  );
}

function rootOpen(classes: string, busy: boolean): string {
  return `<div class="mcp-window ${classes}"${busy ? ' aria-busy="true"' : ''}>`;
}

/** The action needs the MCP server and the bridge is down. Duck typed, so any package's error counts. */
function bridgeMissing(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'BRIDGE_MISSING';
}

/* ── Creature index ───────────────────────────────────────────────── */

export const CREATURE_INDEX_SETTINGS = {
  enabled: 'enableEnhancedCreatureIndex',
  autoRebuild: 'autoRebuildIndex',
} as const;

export interface CreatureIndexDeps {
  service(): CreatureIndexService | undefined;
  settings: SettingsAccess;
}

export class CreatureIndexController implements WindowController {
  #busy = false;
  #status: StatusLine | null = null;

  constructor(
    private readonly host: WindowHost,
    private readonly deps: CreatureIndexDeps = {
      service: () => interfaceService('creatureIndex'),
      settings: moduleSettings,
    }
  ) {}

  #settingsThere(): boolean {
    const { read } = this.deps.settings;
    return (
      typeof read(CREATURE_INDEX_SETTINGS.enabled) === 'boolean' &&
      typeof read(CREATURE_INDEX_SETTINGS.autoRebuild) === 'boolean'
    );
  }

  render(): string {
    const service = this.deps.service();
    const read = this.deps.settings.read;
    const settingsThere = this.#settingsThere();
    return [
      rootOpen('mcp-creature-index', this.#busy),
      `<p class="mcp-window__intro">${esc(t('creatureIndex.intro'))}</p>`,
      `<section class="mcp-window__section">`,
      `<h3>${esc(t('creatureIndex.rebuildHeading'))}</h3>`,
      `<p class="mcp-window__hint">${esc(t('creatureIndex.rebuildHint'))}</p>`,
      service ? '' : unavailableHtml(t('creatureIndex.serviceMissing')),
      buttonHtml(
        'rebuild',
        'fa-arrows-rotate',
        t('creatureIndex.rebuildButton'),
        !service || this.#busy
      ),
      `</section>`,
      `<section class="mcp-window__section">`,
      `<h3>${esc(t('creatureIndex.settingsHeading'))}</h3>`,
      settingsThere ? '' : unavailableHtml(t('creatureIndex.settingsMissing')),
      checkHtml(
        CREATURE_INDEX_SETTINGS.enabled,
        t('creatureIndex.enabled'),
        t('creatureIndex.enabledHint'),
        read(CREATURE_INDEX_SETTINGS.enabled) === true,
        !settingsThere || this.#busy
      ),
      checkHtml(
        CREATURE_INDEX_SETTINGS.autoRebuild,
        t('creatureIndex.autoRebuild'),
        t('creatureIndex.autoRebuildHint'),
        read(CREATURE_INDEX_SETTINGS.autoRebuild) === true,
        !settingsThere || this.#busy
      ),
      `</section>`,
      statusHtml(this.#status),
      footerHtml('save', 'fa-floppy-disk', t('common.save'), !settingsThere || this.#busy),
      `</div>`,
    ].join('');
  }

  async action(name: string, form: FormSnapshot): Promise<void> {
    if (this.#busy) return;
    if (name === 'rebuild') await this.#rebuild();
    else if (name === 'save') await this.#save(form);
  }

  async #rebuild(): Promise<void> {
    const service = this.deps.service();
    if (!service) {
      this.#status = {
        kind: 'error',
        text: t('common.notAvailable', { what: t('creatureIndex.serviceMissing') }),
      };
      this.host.refresh();
      return;
    }
    this.#busy = true;
    this.#status = { kind: 'info', text: announce('indexRebuilding') };
    this.host.refresh();
    try {
      const result = await service.rebuild();
      const texts = [
        announce('indexRebuilt', { creatures: result.creatures, packs: result.packs }),
      ];
      // Nothing swallowed: skipped creatures and an index that was not stored are said out loud.
      if (result.failed) texts.push(announce('indexSkipped', { count: result.failed }));
      if (result.storeProblem) {
        texts.push(announce('indexNotStored', { reason: result.storeProblem }));
      }
      this.#status = { kind: texts.length > 1 ? 'error' : 'ok', text: texts.join(' ') };
    } catch (error) {
      this.#status = {
        kind: 'error',
        text: announce('indexRebuildFailed', { reason: reasonOf(error) }),
      };
    } finally {
      this.#busy = false;
      this.host.refresh();
    }
  }

  async #save(form: FormSnapshot): Promise<void> {
    if (!this.#settingsThere()) {
      this.#status = {
        kind: 'error',
        text: t('common.notAvailable', { what: t('creatureIndex.settingsMissing') }),
      };
      this.host.refresh();
      return;
    }
    const wanted = {
      [CREATURE_INDEX_SETTINGS.enabled]: form.flags[CREATURE_INDEX_SETTINGS.enabled] === true,
      [CREATURE_INDEX_SETTINGS.autoRebuild]:
        form.flags[CREATURE_INDEX_SETTINGS.autoRebuild] === true,
    };
    this.#busy = true;
    this.host.refresh();
    try {
      await writeAndCheck(this.deps.settings, wanted);
      this.#status = { kind: 'ok', text: announce('indexSettingsSaved') };
    } catch (error) {
      this.#status = failure(error);
    } finally {
      this.#busy = false;
      this.host.refresh();
    }
  }
}

/** Write settings, then read them back; a value that did not stick is an error, not a success. */
async function writeAndCheck(
  settings: SettingsAccess,
  values: Record<string, unknown>
): Promise<void> {
  for (const [key, value] of Object.entries(values)) await settings.write(key, value);
  const wrong = Object.entries(values)
    .filter(([key, value]) => settings.read(key) !== value)
    .map(([key]) => key);
  if (wrong.length)
    throw new Error(`${wrong.join(', ')}: the stored value differs from the chosen one`);
}

function failure(error: unknown): StatusLine {
  const text = t('common.failed', { reason: reasonOf(error) });
  ui.notifications?.error(text);
  return { kind: 'error', text };
}

/* ── Release compendiums ──────────────────────────────────────────── */

export interface CompendiumReleaseDeps {
  service(): CompendiumReleaseService | undefined;
  packs(): PackInfo[];
  titleOf: TitleOf;
}

export class CompendiumReleaseController implements WindowController {
  #busy = false;
  #status: StatusLine | null = null;

  constructor(
    private readonly host: WindowHost,
    private readonly deps: CompendiumReleaseDeps = {
      service: () => interfaceService('compendiumRelease'),
      packs: readPacks,
      titleOf: packageTitle,
    }
  ) {}

  #groupTitle(group: ReleaseGroup): string {
    if (group.kind === 'world') return t('release.world');
    const title = this.deps.titleOf(group.kind, group.name);
    return group.kind === 'system' ? t('release.system', { title }) : title;
  }

  #groupHtml(group: ReleaseGroup, disabled: boolean): string {
    const head = ['release', 'name', 'type', 'entries', 'lock']
      .map(column => `<th scope="col">${esc(t(`release.column.${column}`))}</th>`)
      .join('');
    const rows = group.packs
      .map(
        pack =>
          `<tr><td><input type="checkbox" name="pack" data-list="pack" value="${esc(pack.id)}"` +
          ` aria-label="${esc(t('release.releaseOne', { name: pack.label }))}"${checkedIf(pack.checked)}${disabledIf(disabled)}></td>` +
          `<td><span class="mcp-release__label">${esc(pack.label)}</span><small class="mcp-release__id">${esc(pack.id)}</small></td>` +
          `<td>${esc(pack.type)}</td><td class="mcp-release__count">${esc(pack.count)}</td>` +
          `<td>${pack.locked ? `${icon('fa-lock')} ${esc(t('release.locked'))}` : esc(t('release.open'))}</td></tr>`
      )
      .join('');
    return (
      `<fieldset class="mcp-release__group"><legend>${esc(this.#groupTitle(group))}</legend>` +
      `<table class="mcp-release__table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></fieldset>`
    );
  }

  render(): string {
    const service = this.deps.service();
    const problem = service?.problem?.() ?? null;
    const stored = problem ? [] : (service?.read() ?? []);
    const view = buildReleaseView(this.deps.packs(), stored, this.deps.titleOf);
    // A damaged list releases nothing; showing it as "allow all" would be the old failure again.
    const allowAll = view.allowAll && !problem;
    const disabled = !service || this.#busy;
    const groups = view.groups.map(group => this.#groupHtml(group, disabled)).join('');
    return [
      rootOpen('mcp-release', this.#busy),
      `<p class="mcp-window__intro">${esc(t('release.intro'))}</p>`,
      service ? '' : unavailableHtml(t('release.serviceMissing')),
      problem
        ? `<p class="mcp-window__unavailable mcp-release__damaged" role="alert">${esc(t('release.damaged', { problem }))}</p>`
        : '',
      `<label class="mcp-window__check mcp-release__all"><input type="checkbox" name="allowAll" data-release="all"${checkedIf(allowAll)}${disabledIf(disabled)}>`,
      `<span><strong>${esc(t('release.allowAll'))}</strong><small>${esc(t('release.allowAllHint'))}</small></span></label>`,
      `<div class="mcp-release__groups${allowAll ? ' is-dimmed' : ''}" data-release="groups">`,
      groups || `<p class="mcp-window__hint">${esc(t('release.none'))}</p>`,
      `</div>`,
      view.unmatched.length
        ? `<p class="mcp-window__hint mcp-release__unmatched">${esc(t('release.unmatched', { count: view.unmatched.length, entries: view.unmatched.join(', ') }))}</p>`
        : '',
      statusHtml(this.#status),
      footerHtml('save', 'fa-floppy-disk', t('common.save'), disabled),
      `</div>`,
    ].join('');
  }

  async action(name: string, form: FormSnapshot): Promise<void> {
    if (this.#busy || name !== 'save') return;
    const service = this.deps.service();
    if (!service) {
      this.#status = {
        kind: 'error',
        text: t('common.notAvailable', { what: t('release.serviceMissing') }),
      };
      this.host.refresh();
      return;
    }
    const previous = service.problem?.() ? [] : service.read();
    const entries = releaseListFrom(this.deps.packs(), previous, form.lists['pack'] ?? []);
    this.#busy = true;
    this.host.refresh();
    try {
      await service.write(entries);
      const stored = service.read();
      if (!sameEntries(stored, entries)) {
        throw new Error(
          t('release.notStored', { entries: stored.join(', ') || t('release.nothing') })
        );
      }
      if (entries.length) announce('releaseSaved', { count: entries.length });
      else announce('releaseAllowAll');
      this.#busy = false;
      this.host.close();
    } catch (error) {
      this.#busy = false;
      this.#status = {
        kind: 'error',
        text: announce('releaseFailed', { reason: reasonOf(error) }),
      };
      this.host.refresh();
    }
  }
}

/* ── Map generation ───────────────────────────────────────────────── */

export const MAP_SETTINGS = { autoStart: 'mapGenAutoStart', quality: 'mapGenQuality' } as const;
export const MAP_QUALITIES = ['low', 'medium', 'high'] as const;

export interface MapGenerationDeps {
  service(): MapService | undefined;
  settings: SettingsAccess;
}

type MapBusy = 'check' | 'start' | 'stop' | 'apply' | null;

const STATE_KEYS: Record<MapServiceReport['state'], string> = {
  running: 'mapGeneration.stateRunning',
  stopped: 'mapGeneration.stateStopped',
  error: 'mapGeneration.stateError',
  disabled: 'mapGeneration.stateDisabled',
};

export class MapGenerationController implements WindowController {
  #busy: MapBusy = null;
  #report: MapServiceReport | null = null;
  #status: StatusLine | null = null;

  constructor(
    private readonly host: WindowHost,
    private readonly deps: MapGenerationDeps = {
      service: () => interfaceService('mapService'),
      settings: moduleSettings,
    }
  ) {}

  opened(): void {
    if (this.deps.service()) void this.action('check', EMPTY_FORM);
  }

  #settingsThere(): boolean {
    const { read } = this.deps.settings;
    return (
      typeof read(MAP_SETTINGS.autoStart) === 'boolean' &&
      typeof read(MAP_SETTINGS.quality) === 'string'
    );
  }

  #stateText(): string {
    if (this.#busy === 'check') return t('mapGeneration.stateChecking');
    if (this.#busy === 'start') return t('mapGeneration.stateStarting');
    if (this.#busy === 'stop') return t('mapGeneration.stateStopping');
    if (!this.#report) return t('mapGeneration.stateUnknown');
    const text = t(STATE_KEYS[this.#report.state]);
    return this.#report.detail ? `${text} (${this.#report.detail})` : text;
  }

  render(): string {
    const service = this.deps.service();
    const state = this.#report?.state;
    const busy = this.#busy !== null;
    const settingsThere = this.#settingsThere();
    const quality = String(this.deps.settings.read(MAP_SETTINGS.quality) ?? 'low');
    const kind = state === 'running' ? 'ok' : state === 'error' ? 'error' : 'info';
    const options = MAP_QUALITIES.map(
      value =>
        `<option value="${value}"${value === quality ? ' selected' : ''}>${esc(t(`mapGeneration.${value}`))}</option>`
    ).join('');
    return [
      rootOpen('mcp-mapgen', busy),
      `<p class="mcp-window__intro">${esc(t('mapGeneration.intro'))}</p>`,
      `<section class="mcp-window__section">`,
      `<h3>${esc(t('mapGeneration.serviceHeading'))}</h3>`,
      service ? '' : unavailableHtml(t('mapGeneration.serviceMissing')),
      `<p class="mcp-mapgen__state mcp-mapgen__state--${kind}" role="status" aria-live="polite">`,
      `<strong>${esc(t('mapGeneration.state'))}:</strong> ${esc(service ? this.#stateText() : t('mapGeneration.stateUnknown'))}</p>`,
      `<div class="mcp-window__buttons">`,
      buttonHtml('check', 'fa-magnifying-glass', t('mapGeneration.check'), !service || busy),
      buttonHtml(
        'start',
        'fa-play',
        t('mapGeneration.start'),
        !service || busy || state === 'running' || state === 'disabled'
      ),
      buttonHtml(
        'stop',
        'fa-stop',
        t('mapGeneration.stop'),
        !service || busy || state === 'stopped' || state === 'disabled'
      ),
      `</div></section>`,
      `<section class="mcp-window__section">`,
      `<h3>${esc(t('mapGeneration.settingsHeading'))}</h3>`,
      settingsThere ? '' : unavailableHtml(t('mapGeneration.settingsMissing')),
      checkHtml(
        MAP_SETTINGS.autoStart,
        t('mapGeneration.autoStart'),
        t('mapGeneration.autoStartHint'),
        this.deps.settings.read(MAP_SETTINGS.autoStart) === true,
        !settingsThere || busy
      ),
      `<label class="mcp-window__field"><strong>${esc(t('mapGeneration.quality'))}</strong>`,
      `<select name="${MAP_SETTINGS.quality}"${disabledIf(!settingsThere || busy)}>${options}</select>`,
      `<small>${esc(t('mapGeneration.qualityHint'))}</small></label>`,
      `</section>`,
      statusHtml(this.#status),
      footerHtml('apply', 'fa-check', t('common.apply'), !settingsThere || busy),
      `</div>`,
    ].join('');
  }

  async action(name: string, form: FormSnapshot): Promise<void> {
    if (this.#busy !== null) return;
    if (name === 'apply') return this.#apply(form);
    if (name !== 'check' && name !== 'start' && name !== 'stop') return;
    const service = this.deps.service();
    if (!service) {
      this.#status = {
        kind: 'error',
        text: t('common.notAvailable', { what: t('mapGeneration.serviceMissing') }),
      };
      this.host.refresh();
      return;
    }
    this.#busy = name;
    this.#status = name === 'start' ? { kind: 'info', text: announce('comfyStarting') } : null;
    this.host.refresh();
    try {
      if (name === 'check') {
        this.#report = await service.status();
      } else if (name === 'start') {
        const report = await service.start();
        this.#report = { state: report.state, ...(report.detail ? { detail: report.detail } : {}) };
        this.#status = this.#afterStart(report);
      } else {
        const report = await service.stop();
        this.#report = report;
        this.#status = {
          kind: report.state === 'error' ? 'error' : 'ok',
          text: announce('comfyStopped', {
            message: report.detail ?? t(STATE_KEYS[report.state]),
          }),
        };
      }
    } catch (error) {
      this.#report = { state: 'error', detail: reasonOf(error) };
      if (bridgeMissing(error)) {
        this.#status = {
          kind: 'error',
          text: name === 'check' ? messageText('backendMissing') : announce('backendMissing'),
        };
      } else if (name === 'check') {
        this.#status = { kind: 'error', text: t('common.failed', { reason: reasonOf(error) }) };
      } else {
        const key = name === 'start' ? 'comfyStartFailed' : 'comfyStopFailed';
        this.#status = { kind: 'error', text: announce(key, { reason: reasonOf(error) }) };
      }
    } finally {
      this.#busy = null;
      this.host.refresh();
    }
  }

  #afterStart(report: MapServiceReport & { alreadyRunning?: boolean }): StatusLine {
    if (report.alreadyRunning) return { kind: 'ok', text: announce('comfyAlreadyRunning') };
    if (report.state === 'running') return { kind: 'ok', text: announce('comfyStarted') };
    return {
      kind: 'error',
      text: announce('comfyStartFailed', { reason: report.detail ?? t(STATE_KEYS[report.state]) }),
    };
  }

  async #apply(form: FormSnapshot): Promise<void> {
    if (!this.#settingsThere()) {
      this.#status = {
        kind: 'error',
        text: t('common.notAvailable', { what: t('mapGeneration.settingsMissing') }),
      };
      this.host.refresh();
      return;
    }
    const chosen = form.values[MAP_SETTINGS.quality];
    const quality = (MAP_QUALITIES as readonly string[]).includes(chosen ?? '')
      ? chosen
      : this.deps.settings.read(MAP_SETTINGS.quality);
    this.#busy = 'apply';
    this.host.refresh();
    try {
      await writeAndCheck(this.deps.settings, {
        [MAP_SETTINGS.autoStart]: form.flags[MAP_SETTINGS.autoStart] === true,
        [MAP_SETTINGS.quality]: quality,
      });
      this.#status = { kind: 'ok', text: announce('mapgenSaved') };
    } catch (error) {
      this.#status = failure(error);
    } finally {
      this.#busy = null;
      this.host.refresh();
    }
  }
}
