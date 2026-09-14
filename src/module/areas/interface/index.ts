/**
 * Area interface: settings, the three windows as ApplicationV2, compendium release, messages, welcome window.
 *
 * Module side. No queries: the windows only show and ask, and the work behind
 * them is provided by other areas through services.ts.
 */
import type { ModuleArea } from '../../areas.js';
import { welcomeSettingRow, showWelcome } from './welcome.js';
import { installWindowFit } from './window-fit.js';
import { attachInterfaceStylesheet, registerInterfaceMenus } from './window-app.js';

export { announce, MESSAGE_LEVELS, type MessageKey } from './messages.js';
export {
  InterfaceServiceError,
  provideInterfaceService,
  type CompendiumReleaseService,
  type CreatureIndexService,
  type MapService,
} from './services.js';

export const interfaceArea: ModuleArea = {
  id: 'interface',
  queries: [],
  settings: [welcomeSettingRow],
  init: () => {
    attachInterfaceStylesheet();
    registerInterfaceMenus();
  },
  ready: () => {
    installWindowFit();
    // Not awaited: the dialog waits for the Gamemaster, and main.ts starts the bridge after every ready.
    showWelcome().catch(error =>
      console.error('ninjos-foundry-mcp | welcome window failed', error)
    );
  },
};
