/**
 * The map service the window of the interface area calls.
 *
 * Each click is one request to the server (`mapService`, a
 * request from the module). Before, the server held a query open and this
 * side answered it, reporting progress so the silence limit did not end it.
 *
 * The window learns honestly what is possible: without a bridge it says the
 * server is not connected; a server whose generator is off answers
 * `disabled`; a server without requests is too old and says so.
 */
import type { MapServiceAction } from '../../../common/areas/maps/constants.js';
import { requestServer } from '../../core-services.js';
import { localize } from '../../notify.js';
import { ServerRequestError } from '../../server-requests.js';
import {
  InterfaceServiceError,
  type MapService,
  type MapServiceReport,
  type MapServiceState,
} from '../interface/services.js';

/** Longest wait for the server's answer, per action. Start covers ComfyUI's own start limit. */
export const MAP_SERVICE_LIMITS: Readonly<Record<MapServiceAction, number>> = {
  status: 20_000,
  stop: 20_000,
  start: 150_000,
};

export const MAP_SERVICE_REQUEST = 'mapService';

const STATES: ReadonlySet<string> = new Set<MapServiceState>([
  'running',
  'stopped',
  'error',
  'disabled',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failureOf(error: unknown, action: MapServiceAction): InterfaceServiceError {
  if (error instanceof ServerRequestError) {
    if (error.code === 'NOT_CONNECTED')
      return new InterfaceServiceError(
        'BRIDGE_MISSING',
        localize('maps.bridgeMissing', 'The MCP server is not connected.')
      );
    if (error.code === 'TIMEOUT')
      return new InterfaceServiceError(
        'FAILED',
        localize('maps.noAnswer', 'The MCP server did not answer within {seconds} seconds.', {
          seconds: Math.round(MAP_SERVICE_LIMITS[action] / 1000),
        })
      );
    return new InterfaceServiceError('FAILED', error.message);
  }
  return new InterfaceServiceError(
    'FAILED',
    error instanceof Error && error.message ? error.message : String(error)
  );
}

async function ask(
  action: MapServiceAction
): Promise<MapServiceReport & { alreadyRunning?: boolean }> {
  let answer: unknown;
  try {
    answer = await requestServer(
      MAP_SERVICE_REQUEST,
      { action },
      { timeoutMs: MAP_SERVICE_LIMITS[action] }
    );
  } catch (error) {
    throw failureOf(error, action);
  }
  const report = isRecord(answer) ? answer : {};
  const state = report['state'];
  if (typeof state !== 'string' || !STATES.has(state)) {
    throw new InterfaceServiceError(
      'FAILED',
      `The MCP server sent no readable state: ${JSON.stringify(answer)}`
    );
  }
  return {
    state: state as MapServiceState,
    ...(typeof report['detail'] === 'string' ? { detail: report['detail'] } : {}),
    ...(report['alreadyRunning'] === true ? { alreadyRunning: true } : {}),
  };
}

/** The one map service of this module. */
export const mapService: MapService = {
  status: () => ask('status'),
  start: () => ask('start'),
  stop: () => ask('stop'),
};
