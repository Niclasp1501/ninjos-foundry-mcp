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
 * Grown from status-indicator.ts of the production module, which was written
 * in house.
 */
import type { BridgeStatus } from './bridge-client.js';
import { localize } from './notify.js';

const ELEMENT_ID = 'mcp-bridge-status';
const POLL_MS = 5000;

type Kind = 'connected' | 'outdated' | 'standby' | 'connecting' | 'disconnected' | 'disabled';

export interface Readout {
  kind: Kind;
  text: string;
  detail: string;
  blocked?: true;
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
      'No bridge to {where}. Is the MCP server running on the PC? The bridge reconnects on its own once it is. Click to try right away.',
      { where }
    ),
  };
}

function anchor(): HTMLElement | null {
  return document.getElementById('players') ?? document.getElementById('ui-left') ?? document.body;
}

function onActivate(): void {
  const { kind, detail } = read();
  if (kind === 'connected' || kind === 'standby') {
    ui.notifications?.info(detail);
    return;
  }
  if (kind === 'disabled' || kind === 'outdated') {
    ui.notifications?.warn(detail);
    return;
  }
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

function build(): HTMLElement {
  const element = document.createElement('div');
  element.id = ELEMENT_ID;
  element.setAttribute('role', 'button');
  element.tabIndex = 0;
  element.addEventListener('click', onActivate);
  element.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivate();
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
  if (pollTimer !== null) window.clearInterval(pollTimer);
  pollTimer = null;
  document.getElementById(ELEMENT_ID)?.remove();
}
