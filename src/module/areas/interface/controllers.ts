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
import { announce, reasonOf } from './messages.js';
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
