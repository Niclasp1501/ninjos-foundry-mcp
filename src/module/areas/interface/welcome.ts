/**
 * First-run window: what this module is for, and where the other Ninjo
 * modules live.
 *
 * Grown from willkommen.js, the in-house file every Ninjo module carries,
 * brought into the TypeScript build. The MODULE block is the only part that
 * differs per module.
 *
 * Two buttons and one stored boolean. "Don't show again" sets it and the
 * window never returns. "Later" only closes. Clicking away or Escape counts
 * as "Later", never as consent.
 *
 * Gamemasters only: a player can change none of the settings the window
 * talks about. The switch lives per device (client scope) and is not in the
 * settings list; the button in the window is the place for it.
 */
import { MODULE_ID } from '../../../common/constants.js';
import type { SettingRow } from '../../settings.js';
import { readSetting } from '../../settings.js';
import { foundryApi } from './foundry-access.js';
import { escapeHtml } from './html.js';
import { tr } from './texts.js';

/* ── The only part that differs per module ────────────────────────── */

const MODULE = {
  name: "Ninjo's Foundry MCP",
  icon: 'fa-solid fa-plug',
  /** Page on the Forge; null while there is none, then the overview is linked. */
  slug: 'foundry-mcp' as string | null,
  subtitle: 'MCP.Willkommen.Untertitel',
  intro: 'MCP.Willkommen.Einleitung',
  points: ['MCP.Willkommen.Punkt1', 'MCP.Willkommen.Punkt2', 'MCP.Willkommen.Punkt3'],
  start: 'MCP.Willkommen.Start',
};

const FORGE = 'https://ninjos-forge.web.app';
const PATREON = 'https://www.patreon.com/ninjosforge';
export const WELCOME_SETTING = 'willkommenGesehen';

/* ── The same in every module from here on ────────────────────────── */

export const welcomeSettingRow: SettingRow = {
  key: WELCOME_SETTING,
  kind: Boolean,
  initial: false,
  listed: false,
  scope: 'client',
};

/** The module page on the Forge, in the reader's language; the overview while there is no page. */
export function forgeAddress(
  lang: string | undefined = (game.i18n as { lang?: string }).lang
): string {
  const en = lang?.startsWith('en') ? '/en' : '';
  return MODULE.slug ? `${FORGE}${en}/modules/${MODULE.slug}` : `${FORGE}${en}/modules`;
}

/** Translate when it looks like a key, otherwise pass through. */
function text(value: string): string {
  return /^[A-Z0-9]+\.[A-Za-z0-9.]+$/.test(value) ? tr(value) : value;
}

/** A little CSS, injected once, so the window does not depend on a stylesheet being listed. */
function attachStyle(): void {
  if (document.getElementById('ninjo-willkommen-stil')) return;
  const style = document.createElement('style');
  style.id = 'ninjo-willkommen-stil';
  style.textContent = `
    .ninjo-willkommen { font-size: 0.95rem; line-height: 1.5; color: inherit; }
    .ninjo-willkommen-kopf {
      display: flex; gap: 0.9rem; align-items: center;
      margin: -0.5rem -0.5rem 0.9rem; padding: 0.7rem 0.9rem;
      border-bottom: 2px solid var(--ninjo-akzent, #D4AF37);
      background: linear-gradient(180deg, var(--ninjo-marke, #8B0000) 0%, var(--ninjo-marke-tief, #5e0000) 100%);
      color: var(--ninjo-auf-marke, #fff);
    }
    .ninjo-willkommen-kopf img {
      flex: 0 0 auto; width: 60px; height: 60px; object-fit: contain;
      filter: drop-shadow(0 2px 3px rgb(0 0 0 / 45%));
    }
    .ninjo-willkommen-kopf h2 {
      margin: 0; border: none; padding: 0;
      color: var(--ninjo-akzent, #D4AF37); font-size: 1.05rem; font-weight: 700; line-height: 1.2;
    }
    .ninjo-willkommen-kopf p { margin: 0.15rem 0 0; color: rgb(255 255 255 / 85%); font-size: 0.82rem; }
    .ninjo-willkommen p { margin: 0 0 0.7rem; }
    .ninjo-willkommen ul { margin: 0 0 0.9rem; padding-left: 1.2rem; }
    .ninjo-willkommen li { margin: 0.25rem 0; }
    .ninjo-willkommen-start {
      margin: 0 0 0.9rem; padding: 0.5rem 0.7rem;
      border-left: 3px solid var(--ninjo-akzent, #D4AF37);
      background: rgb(212 175 55 / 10%); color: inherit;
    }
    a.ninjo-willkommen-forge {
      display: flex; gap: 0.8rem; align-items: center;
      margin: 1rem -0.5rem 0; padding: 0.75rem 0.9rem;
      border-top: 2px solid var(--ninjo-akzent, #D4AF37);
      background: linear-gradient(180deg, var(--ninjo-marke-tief, #5e0000) 0%, var(--ninjo-marke, #8B0000) 100%);
      color: var(--ninjo-auf-marke, #fff); text-decoration: none; transition: filter 0.15s;
    }
    a.ninjo-willkommen-forge:hover { filter: brightness(1.18); text-decoration: none; }
    a.ninjo-willkommen-forge:focus-visible { outline: 2px solid var(--ninjo-akzent, #D4AF37); outline-offset: 2px; }
    a.ninjo-willkommen-forge img {
      flex: 0 0 auto; width: 38px; height: 38px; object-fit: contain;
      filter: drop-shadow(0 2px 3px rgb(0 0 0 / 45%));
    }
    .ninjo-willkommen-forge-text { flex: 1 1 auto; min-width: 0; }
    .ninjo-willkommen-forge-titel { display: block; color: var(--ninjo-akzent, #D4AF37); font-size: 0.95rem; font-weight: 700; line-height: 1.2; }
    .ninjo-willkommen-forge-zeile { display: block; margin-top: 0.1rem; color: rgb(255 255 255 / 88%); font-size: 0.8rem; line-height: 1.35; }
    a.ninjo-willkommen-forge > i:last-child { flex: 0 0 auto; color: var(--ninjo-akzent, #D4AF37); font-size: 1rem; }
    /* Patreon as a second, quieter line in the same strip: one sentence, not a second sign. */
    a.ninjo-willkommen-patreon {
      display: flex; gap: 0.55rem; align-items: center;
      margin: 0 -0.5rem -0.5rem; padding: 0.45rem 0.9rem 0.55rem;
      border-top: 1px solid rgb(212 175 55 / 35%);
      background: var(--ninjo-marke, #8B0000);
      color: rgb(255 255 255 / 88%); font-size: 0.8rem; line-height: 1.35;
      text-decoration: none; transition: filter 0.15s;
    }
    a.ninjo-willkommen-patreon:hover { filter: brightness(1.18); text-decoration: none; }
    a.ninjo-willkommen-patreon:focus-visible { outline: 2px solid var(--ninjo-akzent, #D4AF37); outline-offset: 2px; }
    a.ninjo-willkommen-patreon > i { flex: 0 0 auto; color: var(--ninjo-akzent, #D4AF37); font-size: 0.95rem; }
  `;
  document.head.append(style);
}

/** The content of the window as HTML text. */
export function welcomeContent(): string {
  const logo = `modules/${MODULE_ID}/assets/ninjo.png`;
  const points = MODULE.points.map(point => `<li>${escapeHtml(text(point))}</li>`).join('');
  return `
    <div class="ninjo-willkommen">
      <div class="ninjo-willkommen-kopf">
        <img src="${logo}" alt="">
        <div>
          <h2>${escapeHtml(MODULE.name)}</h2>
          <p>${escapeHtml(text(MODULE.subtitle))}</p>
        </div>
      </div>
      <p>${escapeHtml(text(MODULE.intro))}</p>
      <ul>${points}</ul>
      <p class="ninjo-willkommen-start">${escapeHtml(text(MODULE.start))}</p>
      <a class="ninjo-willkommen-forge" href="${escapeHtml(forgeAddress())}" target="_blank" rel="noopener">
        <img src="${logo}" alt="">
        <span class="ninjo-willkommen-forge-text">
          <span class="ninjo-willkommen-forge-titel">Ninjo's Forge</span>
          <span class="ninjo-willkommen-forge-zeile">${escapeHtml(text('MCP.Willkommen.ForgeZeile'))}</span>
        </span>
        <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
      </a>
      <a class="ninjo-willkommen-patreon" href="${PATREON}" target="_blank" rel="noopener">
        <i class="fa-brands fa-patreon" aria-hidden="true"></i>
        <span>${escapeHtml(text('MCP.Willkommen.PatreonZeile'))}</span>
      </a>
    </div>`;
}

export type WelcomeOutcome = 'never' | 'later' | 'skipped';

/**
 * Show the window once per device, for a Gamemaster. Resolves when it is
 * closed, so the caller must not wait for it before starting anything else.
 */
export async function showWelcome(
  api: FoundryInterfaceApi | undefined = foundryApi()
): Promise<WelcomeOutcome> {
  if (!game.user?.isGM) return 'skipped';
  // true: dismissed for good. undefined: not registered, nothing to remember the answer in.
  if (readSetting(WELCOME_SETTING) !== false) return 'skipped';
  if (!api) return 'skipped';
  if (typeof document !== 'undefined') attachStyle();

  const answer = await api.DialogV2.wait({
    window: { title: MODULE.name, icon: MODULE.icon },
    classes: [MODULE_ID],
    position: { width: 480 },
    content: welcomeContent(),
    buttons: [
      {
        action: 'nie',
        label: text('MCP.Willkommen.Nie'),
        icon: 'fa-solid fa-check',
        default: true,
      },
      { action: 'spaeter', label: text('MCP.Willkommen.Spaeter'), icon: 'fa-solid fa-xmark' },
    ],
    rejectClose: false,
  });

  if (answer === 'nie') {
    await game.settings.set(MODULE_ID, WELCOME_SETTING, true);
    return 'never';
  }
  return 'later';
}
