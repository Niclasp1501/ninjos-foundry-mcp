/**
 * The three settings windows as ApplicationV2, and their entries in the
 * module settings.
 *
 * The class is built at init from `foundry.applications.api.ApplicationV2`,
 * which only exists inside Foundry. Everything the window shows and does is
 * in a controller (controllers.ts); this file only puts it into a window:
 * render the HTML, read the form, forward the action.
 *
 * Every window carries the module id as a class on its frame, so the window
 * fitting (window-fit.ts) keeps it inside the visible area.
 */
import { MODULE_ID } from '../../../common/constants.js';
import {
  CompendiumReleaseController,
  CreatureIndexController,
  MapGenerationController,
  type FormSnapshot,
  type WindowController,
  type WindowHost,
} from './controllers.js';
import { foundryApi } from './foundry-access.js';
import { escapeHtml } from './html.js';
import { reasonOf } from './messages.js';
import { t } from './texts.js';

export interface WindowSpec {
  /** Key of the settings menu; the window id is derived from it. */
  key: string;
  /** Text key under `interface.` of the menu name, label and hint. */
  menu: string;
  /** Text key under `interface.` of the window title. */
  title: string;
  icon: string;
  width: number;
  actions: readonly string[];
  create(host: WindowHost): WindowController;
  /** Listeners that act on the DOM directly, after each render. */
  wire?(root: HTMLElement): void;
}

interface FormField {
  name: string;
  type?: string;
  value: string;
  checked?: boolean;
  dataset?: Record<string, string | undefined>;
}

/** Read every named field of a window, by name and value. Field names are never expanded. */
export function readForm(root: Pick<ParentNode, 'querySelectorAll'>): FormSnapshot {
  const form: FormSnapshot = { flags: {}, values: {}, lists: {} };
  const fields = root.querySelectorAll('input[name], select[name], textarea[name]');
  for (const node of Array.from(fields as ArrayLike<unknown>)) {
    const field = node as FormField;
    if (field.type === 'checkbox') {
      const list = field.dataset?.['list'];
      if (list) {
        if (field.checked) (form.lists[list] ??= []).push(field.value);
      } else {
        form.flags[field.name] = field.checked === true;
      }
    } else {
      form.values[field.name] = field.value;
    }
  }
  return form;
}

/**
 * Tick and untick in the release window: the box at the top and the boxes
 * below exclude each other, and the list is dimmed while the top box is set.
 */
export function wireReleaseExclusion(root: HTMLElement): void {
  const all = root.querySelector<HTMLInputElement>('input[data-release="all"]');
  const groups = root.querySelector<HTMLElement>('[data-release="groups"]');
  if (!all || !groups) return;
  const boxes = () =>
    Array.from(root.querySelectorAll<HTMLInputElement>('input[data-list="pack"]'));
  const dim = () => groups.classList.toggle('is-dimmed', all.checked);
  all.addEventListener('change', () => {
    if (all.checked) for (const box of boxes()) box.checked = false;
    dim();
  });
  for (const box of boxes()) {
    box.addEventListener('change', () => {
      all.checked = !boxes().some(other => other.checked);
      dim();
    });
  }
}

export function windowSpecs(): WindowSpec[] {
  return [
    {
      key: 'creatureIndexMenu',
      menu: 'menu.creatureIndex',
      title: 'creatureIndex.title',
      icon: 'fa-dragon',
      width: 560,
      actions: ['rebuild', 'save'],
      create: host => new CreatureIndexController(host),
    },
    {
      key: 'compendiumReleaseMenu',
      menu: 'menu.compendiumRelease',
      title: 'release.title',
      icon: 'fa-book-open',
      width: 620,
      actions: ['save'],
      create: host => new CompendiumReleaseController(host),
      wire: wireReleaseExclusion,
    },
    {
      key: 'mapGenerationMenu',
      menu: 'menu.mapGeneration',
      title: 'mapGeneration.title',
      icon: 'fa-map',
      width: 560,
      actions: ['check', 'start', 'stop', 'apply'],
      create: host => new MapGenerationController(host),
    },
  ];
}

const isGM = () => game.user?.isGM === true;

/** One ApplicationV2 class for one spec. */
export function defineWindow(
  api: FoundryInterfaceApi,
  spec: WindowSpec
): FoundryInterfaceApplicationClass {
  const actions = Object.fromEntries(
    spec.actions.map(name => [
      name,
      function (this: InterfaceWindow, event?: Event) {
        event?.preventDefault();
        void this.runAction(name);
      },
    ])
  );

  class InterfaceWindow extends api.ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: `${MODULE_ID}-${spec.key}`,
      classes: [MODULE_ID, 'mcp-window-frame'],
      tag: 'div',
      window: { icon: `fa-solid ${spec.icon}`, resizable: true },
      position: { width: spec.width, height: 'auto' },
      actions,
    };

    readonly controller: WindowController;
    #opened = false;

    constructor(options: Record<string, unknown> = {}) {
      // The title is translated when the window opens, when the language files are loaded for sure.
      super({
        ...options,
        window: { ...((options['window'] as object | undefined) ?? {}), title: t(spec.title) },
      });
      this.controller = spec.create({
        refresh: () => {
          if (this.rendered) void this.render();
        },
        close: () => {
          void this.close();
        },
      });
    }

    override async _renderHTML(): Promise<unknown> {
      if (!isGM()) {
        return `<div class="mcp-window"><p class="mcp-window__unavailable">${escapeHtml(t('common.gmOnly'))}</p></div>`;
      }
      return this.controller.render();
    }

    override _replaceHTML(result: unknown, content: HTMLElement): void {
      content.innerHTML = String(result);
    }

    override _onRender(): void {
      if (!isGM()) return;
      spec.wire?.(this.element);
      if (!this.#opened) {
        this.#opened = true;
        this.controller.opened?.();
      }
    }

    async runAction(name: string): Promise<void> {
      if (!isGM()) return;
      try {
        await this.controller.action(name, readForm(this.element));
      } catch (error) {
        console.error(`${MODULE_ID} | window action "${name}" failed`, error);
        ui.notifications?.error(t('common.failed', { reason: reasonOf(error) }));
      }
    }
  }

  return InterfaceWindow;
}

/**
 * Register the three windows as entries in the module settings, for the
 * Gamemaster only. Runs at init. Returns false outside Foundry.
 */
export function registerInterfaceMenus(
  api: FoundryInterfaceApi | undefined = foundryApi()
): boolean {
  const settings = game.settings as unknown as {
    registerMenu?(namespace: string, key: string, config: FoundryInterfaceMenuConfig): void;
  };
  if (!api || typeof settings.registerMenu !== 'function') {
    console.warn(`${MODULE_ID} | no ApplicationV2 here, the settings windows are not registered`);
    return false;
  }
  for (const spec of windowSpecs()) {
    const base = `${MODULE_ID}.interface.${spec.menu}`;
    // Foundry translates name, label and hint itself when it shows the settings.
    settings.registerMenu(MODULE_ID, spec.key, {
      name: `${base}.name`,
      label: `${base}.label`,
      hint: `${base}.hint`,
      icon: `fa-solid ${spec.icon}`,
      type: defineWindow(api, spec),
      restricted: true,
    });
  }
  return true;
}

const STYLESHEET_ID = `${MODULE_ID}-interface-css`;

/**
 * Load module/styles/interface.css. A workaround until the core lists it in
 * module.json after ninjo-marke.css.
 */
export function attachInterfaceStylesheet(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLESHEET_ID)) return;
  const listed = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
  ).some(link => link.href.includes(`modules/${MODULE_ID}/styles/interface.css`));
  if (listed) return;
  const link = document.createElement('link');
  link.id = STYLESHEET_ID;
  link.rel = 'stylesheet';
  link.href = `modules/${MODULE_ID}/styles/interface.css`;
  document.head.append(link);
}
