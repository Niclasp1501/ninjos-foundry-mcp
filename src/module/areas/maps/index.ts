/**
 * Area maps: map generator through ComfyUI, only when switched on.
 *
 * Module side: storing the image, creating the scene, the service for the map
 * generation window of the interface area, failure messages, the two settings.
 * mapGenAutoStart is read by the server when the module introduces itself
 * (getMapSettings), because at ready the bridge of this browser is not open yet.
 */
import { LEGACY_MAP_QUERY, MAP_QUERY } from '../../../common/areas/maps/constants.js';
import type { ModuleArea } from '../../areas.js';
import { provideInterfaceService } from '../interface/index.js';
import { mapService } from './channel.js';
import { getMapSettings, legacyMapRelay, MAP_SETTING_ROWS, mapJobFailed } from './queries.js';
import { createMapScene } from './scene.js';
import { uploadGeneratedMap, uploadMapChunk } from './upload.js';

export const mapsArea: ModuleArea = {
  id: 'maps',
  queries: [
    { names: MAP_QUERY.settings, handler: getMapSettings },
    { names: MAP_QUERY.uploadChunk, handler: uploadMapChunk },
    { names: MAP_QUERY.createScene, handler: createMapScene },
    { names: MAP_QUERY.jobFailed, handler: mapJobFailed },
    { names: LEGACY_MAP_QUERY.upload, handler: uploadGeneratedMap },
    {
      names: [LEGACY_MAP_QUERY.generate, LEGACY_MAP_QUERY.status, LEGACY_MAP_QUERY.cancel],
      handler: legacyMapRelay,
    },
  ],
  settings: MAP_SETTING_ROWS,
  init: () => {
    provideInterfaceService('mapService', mapService);
  },
};
