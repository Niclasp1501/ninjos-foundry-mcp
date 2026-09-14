/**
 * Area interface: settings, the three windows as ApplicationV2, compendium release, messages, welcome window.
 *
 * Module side. No queries: the windows only show and ask, and the work behind
 * them is provided by other areas through services.ts.
 */
import type { ModuleArea } from '../../areas.js';
import {
  listenForPreviousServer,
  showUpdateNotice,
  updateNoticeSettingRow,
  watchEarlierVersion,
} from './update-notice.js';
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
  settings: [welcomeSettingRow, updateNoticeSettingRow],
  init: () => {
    attachInterfaceStylesheet();
    registerInterfaceMenus();
    watchEarlierVersion();
  },
  ready: () => {
    installWindowFit();
    // Before the bridge starts in main.ts, so an old server found right away is not missed.
    listenForPreviousServer();
    // Not awaited: the dialogs wait for the Gamemaster, and main.ts starts the bridge after every ready.
    showWelcome().catch(error =>
      console.error('ninjos-foundry-mcp | welcome window failed', error)
    );
    showUpdateNotice().catch(error =>
      console.error('ninjos-foundry-mcp | update notice failed', error)
    );
  },
};
