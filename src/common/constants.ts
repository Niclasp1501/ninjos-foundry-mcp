/**
 * Names both sides of the bridge must agree on.
 *
 * Every value here is part of the compatibility contract: an installed module
 * of the previous generation talks to this server and the other way round, so
 * none of these may change without a transition that keeps both spellings.
 */

/** Foundry package id. Worlds store settings under it. */
export const MODULE_ID = 'ninjos-foundry-mcp';

/** Every query the server sends carries this prefix in front of its name. */
export const QUERY_PREFIX = `${MODULE_ID}.`;

/** The WebSocket path of the bridge. Other paths are refused. */
export const BRIDGE_PATH = '/foundry-mcp';

/** Label of the WebRTC data channel used by the legacy detour. */
export const DATA_CHANNEL_LABEL = 'foundry-mcp';

/**
 * Protocol generation spoken by this code.
 *
 * Generation 1 is the previous server and module: queries, responses and
 * pings only. Generation 2 adds hello, welcome, role and progress messages.
 * A peer that never says hello is treated as generation 1 and never receives a
 * message type it would not understand.
 */
export const BRIDGE_PROTOCOL = 2;

/** WebSocket close code for a page whose origin is not allowed. */
export const CLOSE_ORIGIN_REJECTED = 4403;

/** Default ports. Always overridable through the environment. */
export const DEFAULT_CONTROL_PORT = 31414;
export const DEFAULT_BRIDGE_PORT = 31415;
export const DEFAULT_SIGNALING_PORT = 31416;

/** Build the full query name the module registers its handler under. */
export function fullQueryName(name: string): string {
  return name.startsWith(QUERY_PREFIX) ? name : `${QUERY_PREFIX}${name}`;
}

/** The short query name without the module prefix. */
export function shortQueryName(name: string): string {
  return name.startsWith(QUERY_PREFIX) ? name.slice(QUERY_PREFIX.length) : name;
}
