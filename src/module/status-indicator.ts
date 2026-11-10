/**
 * A small, always visible readout of the bridge state, for the GM.
 *
 * On 06.09.2026 the bridge was down for eleven hours and nobody noticed: the
 * backend had failed to open its port, still offered every tool, and answered
 * each call with "module not connected". Nothing in Foundry showed it. A tool
 * that answers an error looks like a tool having a bad day; a dot in the
 * corner does not.
 *
 * Rules: GM only. Quiet when things work (small green dot), loud when they do
 * not (red, and it stays red). Switched off is grey, not red, so a deliberate
 * "off" never looks like a fault. New here: amber for a tab on standby while
 * another tab or world holds the bridge.
 *
 * A click opens a small menu: "Connect now", and switching the bridge off or
 * on for this device only. A laptop at the table without the MCP server keeps
 * quiet that way, while the PC that runs the server connects as before. The
 * readout stays visible when switched off, because it is the way back.
 *
 * Grown from status-indicator.ts of the production module, which was written
 * in house.
 */
import type { BridgeStatus } from './bridge-client.js';
import { localize } from './notify.js';
import { setBridgeOffOnDevice } from './settings.js';

const ELEMENT_ID = 'mcp-bridge-status';
const MENU_ID = 'mcp-bridge-status-menu';
const POLL_MS = 5000;
/** Distance of the menu from the edge of the visible area, wide enough to still hit it. */
const EDGE_PX = 8;

type Kind = 'connected' | 'outdated' | 'standby' | 'connecting' | 'disconnected' | 'disabled';

export interface Readout {
  kind: Kind;
  text: string;
  detail: string;
  blocked?: true;
  /** Off because of the switch of this device, not the one of the world. */
  offOnDevice?: true;
}

export type MenuAction = 'connect' | 'deviceOff' | 'deviceOn';

/**
 * What the menu offers for a readout. Switched off here: only the way back.
 * Otherwise switching off for this device, and "Connect now" whenever the
 * bridge is not connected but could be.
 */
export function menuActions(readout: Readout): MenuAction[] {
  if (readout.offOnDevice) return ['deviceOn'];
  const actions: MenuAction[] = [];
  if (readout.kind === 'disconnected' || readout.kind === 'connecting') actions.push('connect');
  actions.push('deviceOff');
  return actions;
}

interface BridgeHandle {
  getStatus(): BridgeStatus;
  start(): void;
}

let pollTimer: number | null = null;

function bridge(): BridgeHandle | undefined {
  return (window as unknown as { foundryMCPBridge?: BridgeHandle }).foundryMCPBridge;
}

const t = (key: string, fallback: string, data?: Record<string, string>) =>
  localize(`indicator.${key}`, fallback, data);

/** Never throws: a readout that can crash is worse than none. */
function read(): Readout {
  let status: BridgeStatus | undefined;
  try {
    status = bridge()?.getStatus();
  } catch {
    status = undefined;
  }
  return describeBridgeStatus(status);
}

/** The readout for a bridge state; undefined means the bridge reports nothing. */
export function describeBridgeStatus(status: BridgeStatus | undefined): Readout {
  if (!status) {
    return {
      kind: 'disconnected',
      text: t('unknown', 'MCP: no answer'),
      detail: t('unknownDetail', 'The module is loaded but reports no state.'),
    };
  }

  const info = status.connectionInfo;
  const where = `${info.config.host}:${info.config.port}`;

  // Before every other state: a tab switched off here is off, whatever it was before.
  if (status.offOnThisDevice) {
    return {
      kind: 'disabled',
      offOnDevice: true,
      text: t('offDevice', 'MCP: off on this device'),
      detail: t(
        'offDeviceDetail',
        'The bridge is switched off on this device only. Other devices connect as usual. To switch it on, click here and choose "Switch on for this device".'
      ),
    };
  }

  if (!status.enabled) {
    return {
      kind: 'disabled',
      text: t('off', 'MCP: off'),
      detail: t('offDetail', 'The bridge is switched off in the module settings.'),
    };
  }

  if (status.connectionState === 'rejected') {
    return {
      kind: 'disconnected',
      blocked: true,
      text: t('blocked', 'MCP: address not allowed'),
      detail: t(
        'blockedDetail',
        'The MCP server on the PC does not accept connections from {origin}. Add the address to FOUNDRY_ALLOWED_ORIGINS there, or delete allowed-origins.json so it learns this address again.',
        { origin: info.pageOrigin }
      ),
    };
  }

  if (status.connected && info.role === 'standby') {
    return {
      kind: 'standby',
      text: t('standby', 'MCP: standby'),
      detail: t(
        'standbyDetail',
        'Another tab or world holds the bridge ({world}). This tab takes over when that one closes.',
        { world: info.activeWorld ?? '?' }
      ),
    };
  }

  if (status.connected && info.previousServer) {
    return {
      kind: 'outdated',
      text: t('outdated', 'MCP: old server'),
      detail: t(
        'outdatedDetail',
        'Connected to {where}, but the MCP server on the PC is of the previous generation. Set it up anew with the new server package from the releases page, then restart your MCP client.',
        { where }
      ),
    };
  }

  if (status.connected) {
    return {
      kind: 'connected',
      text: t('on', 'MCP: connected'),
      detail: t('onDetail', 'Bridge to {where}', { where }),
    };
  }

  if (status.connectionState === 'connecting' || status.connectionState === 'reconnecting') {
    return {
      kind: 'connecting',
      text: t('connecting', 'MCP: connecting'),
      detail: info.reconnectAttempts
        ? t('attempt', 'Attempt {count} to reach {where}', {
            count: String(info.reconnectAttempts),
            where,
          })
        : where,
    };
  }

  return {
    kind: 'disconnected',
    text: t('down', 'MCP: disconnected'),
    detail: t(
      'downDetail',
      'No bridge to {where}. Is the MCP server running on the PC? The bridge reconnects on its own once it is. A click opens the menu with "Connect now".',
      { where }
    ),
  };
}

function anchor(): HTMLElement | null {
  return document.getElementById('players') ?? document.getElementById('ui-left') ?? document.body;
}

function connectNow(): void {
  ui.notifications?.info(t('retrying', 'Reconnecting the MCP bridge'));
  try {
    bridge()?.start();
  } catch (error) {
    ui.notifications?.error(
      t('retryFailed', 'Reconnecting failed: {reason}', {
        reason: error instanceof Error ? error.message : String(error),
      })
    );
  }
  refreshStatusIndicator();
}

function switchDevice(off: boolean): void {
  // The onChange of the setting starts or stops the bridge; the readout follows.
  setBridgeOffOnDevice(off)
    .catch(error => {
      ui.notifications?.error(
        t('switchFailed', 'The MCP bridge could not be switched on this device: {reason}', {
          reason: error instanceof Error ? error.message : String(error),
        })
      );
    })
    .finally(refreshStatusIndicator);
}

function run(action: MenuAction): void {
  if (action === 'connect') connectNow();
  else switchDevice(action === 'deviceOff');
}

const MENU_TEXT: Record<MenuAction, { key: string; fallback: string; hint: string }> = {
  connect: {
    key: 'connectNow',
    fallback: 'Connect now',
    hint: 'Connect now: tries to reach the MCP server right away.',
  },
  deviceOff: {
    key: 'deviceOff',
    fallback: 'Switch off for this device',
    hint: 'Switch off for this device: this browser no longer builds the bridge and shows no messages about it. Other devices are not affected.',
  },
  deviceOn: {
    key: 'deviceOn',
    fallback: 'Switch on for this device',
    hint: 'Switch on for this device: this browser connects to the MCP server again.',
  },
};

let closeOpenMenu: (() => void) | null = null;

function closeMenu(): void {
  closeOpenMenu?.();
  closeOpenMenu = null;
}

/** The visible area, with the on screen keyboard and split screen taken into account. */
function visibleArea(): { width: number; height: number } {
  const viewport = window.visualViewport;
  return {
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
  };
}

/** Below the readout if it fits, else above; always wholly inside the visible area. */
function placeMenu(menu: HTMLElement, anchorElement: HTMLElement): void {
  const area = visibleArea();
  menu.style.maxWidth = `${Math.max(0, area.width - 2 * EDGE_PX)}px`;
  menu.style.maxHeight = `${Math.max(0, area.height - 2 * EDGE_PX)}px`;
  const rect = anchorElement.getBoundingClientRect();
  const { width, height } = menu.getBoundingClientRect();
  let top = rect.bottom + 4;
  if (top + height > area.height - EDGE_PX) top = rect.top - height - 4;
  top = Math.min(Math.max(EDGE_PX, top), Math.max(EDGE_PX, area.height - height - EDGE_PX));
  const left = Math.min(
    Math.max(EDGE_PX, rect.left),
    Math.max(EDGE_PX, area.width - width - EDGE_PX)
  );
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
}

function openMenu(anchorElement: HTMLElement): void {
  closeMenu();
  const readout = read();
  const menu = document.createElement('div');
  menu.id = MENU_ID;
  menu.className = 'mcp-status-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', t('menu', 'MCP bridge'));

  const detail = document.createElement('p');
  detail.className = 'mcp-status-menu__detail';
  // textContent, never innerHTML: the detail carries a host name from the settings.
  detail.textContent = readout.detail;
  menu.append(detail);

  const items = menuActions(readout).map(action => {
    const { key, fallback, hint } = MENU_TEXT[action];
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `mcp-status-menu__item mcp-status-menu__item--${action}`;
    item.setAttribute('role', 'menuitem');
    item.textContent = t(key, fallback);
    item.setAttribute('aria-label', t(`${key}Hint`, hint));
    item.addEventListener('click', () => {
      closeMenu();
      run(action);
    });
    return item;
  });
  menu.append(...items);

  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
      anchorElement.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    items[(index + step + items.length) % items.length]?.focus();
  });

  document.body.append(menu);
  placeMenu(menu, anchorElement);
  anchorElement.setAttribute('aria-expanded', 'true');

  // A click beside the menu, a change of the visible area or Escape closes it; none of them acts.
  const outside = (event: PointerEvent) => {
    const target = event.target as Node | null;
    if (target && (menu.contains(target) || anchorElement.contains(target))) return;
    closeMenu();
  };
  const away = () => closeMenu();
  document.addEventListener('pointerdown', outside, true);
  window.addEventListener('resize', away);
  window.visualViewport?.addEventListener('resize', away);
  closeOpenMenu = () => {
    document.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('resize', away);
    window.visualViewport?.removeEventListener('resize', away);
    menu.remove();
    anchorElement.setAttribute('aria-expanded', 'false');
  };
  items[0]?.focus();
}

function toggleMenu(anchorElement: HTMLElement): void {
  if (document.getElementById(MENU_ID)) closeMenu();
  else openMenu(anchorElement);
}

function build(): HTMLElement {
  const element = document.createElement('div');
  element.id = ELEMENT_ID;
  element.setAttribute('role', 'button');
  element.setAttribute('aria-haspopup', 'menu');
  element.setAttribute('aria-expanded', 'false');
  element.tabIndex = 0;
  element.addEventListener('click', () => toggleMenu(element));
  element.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleMenu(element);
    }
  });
  const dot = document.createElement('span');
  dot.className = 'mcp-status__dot';
  dot.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'mcp-status__text';
  label.setAttribute('aria-live', 'polite');
  element.append(dot, label);
  return element;
}

/** Write the current state into the element. Cheap enough for a timer. */
export function refreshStatusIndicator(): void {
  const element = document.getElementById(ELEMENT_ID);
  if (!element) return;
  const { kind, text, detail } = read();
  element.className = `mcp-status mcp-status--${kind}`;
  element.title = detail;
  // textContent, never innerHTML: the detail carries a host name from the settings.
  element.setAttribute('aria-label', `${text}. ${detail}`);
  const label = element.querySelector('.mcp-status__text');
  if (label) label.textContent = text;
}

/**
 * Put the readout on screen and keep it there. Foundry re-renders the player
 * list on its own and throws the element away with it, so every render puts
 * it back.
 */
export function installStatusIndicator(): void {
  if (!game.user?.isGM) return;

  const place = () => {
    const host = anchor();
    if (!host) return;
    if (!host.querySelector(`#${ELEMENT_ID}`)) {
      document.getElementById(ELEMENT_ID)?.remove();
      host.prepend(build());
    }
    refreshStatusIndicator();
  };

  place();
  Hooks.on('renderPlayers', place);
  Hooks.on('renderPlayerList', place);

  if (pollTimer === null) {
    // A timer as well as events: the interesting failure is the one where no event ever arrives.
    pollTimer = window.setInterval(refreshStatusIndicator, POLL_MS);
  }
}

export function removeStatusIndicator(): void {
  closeMenu();
  if (pollTimer !== null) window.clearInterval(pollTimer);
  pollTimer = null;
  document.getElementById(ELEMENT_ID)?.remove();
}
