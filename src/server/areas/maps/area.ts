/**
 * The server area on the lifecycle of the core.
 *
 * - `start` creates the runtime when COMFYUI_ENABLED is true, so
 *   FOUNDRY_MCP_AUTOSTART_COMFYUI works from the backend start on.
 * - `stop` closes it inside `close` of the backend; ComfyUI started by this
 *   server ends with it.
 * - The request `mapService` answers the window of the interface area: status, start
 *   and stop. Without a runtime it answers `disabled`, with the reason.
 * - When a module introduces itself, failures that could not be shown are
 *   delivered, and `mapGenAutoStart` of the world starts ComfyUI.
 */
import type { ServerArea } from '../../tools/areas.js';
import { ServerRequestError, type ServerRequestDefinition } from '../../tools/requests.js';
import { MapsError, messageOf } from './errors.js';
import { mapTools, type MapsRuntimeHolder } from './tools.js';

const ACTIONS = ['status', 'start', 'stop'] as const;
type Action = (typeof ACTIONS)[number];

function isAction(value: unknown): value is Action {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
}

export function mapServiceRequest(holder: MapsRuntimeHolder): ServerRequestDefinition {
  return {
    names: 'mapService',
    run: async data => {
      const action = (typeof data === 'object' && data !== null ? data : {}) as {
        action?: unknown;
      };
      if (!isAction(action.action))
        throw new ServerRequestError(
          'INVALID_ARGUMENT',
          `action must be status, start or stop, got ${JSON.stringify(action.action ?? null)}`
        );
      const runtime = holder.current;
      if (!runtime) {
        return {
          state: 'disabled',
          detail:
            holder.problem ??
            'The map generator is switched off on this server (COMFYUI_ENABLED is not true).',
        };
      }
      try {
        return await runtime.service[action.action]();
      } catch (error) {
        throw new ServerRequestError(
          error instanceof MapsError ? error.code : 'FAILED',
          messageOf(error)
        );
      }
    },
  };
}

export function createMapsArea(holder: MapsRuntimeHolder): ServerArea {
  return {
    id: 'maps',
    tools: mapTools(holder),
    resources: [],
    prompts: [],
    requests: [mapServiceRequest(holder)],
    start: context => holder.start(context),
    stop: () => holder.close(),
    onModuleConnection: async event => {
      if (event.type === 'introduced') await holder.current?.moduleIntroduced();
    },
  };
}
