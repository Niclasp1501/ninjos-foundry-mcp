/**
 * Area maps: the module side of the image generator.
 *
 * The server asks Gemini for the image; the module stores it in the data
 * folder, reads existing images as references and draws previews. The scene
 * itself is created through the query of the scenes area, so a generated map
 * gets the same folders, templates and checks as any other scene.
 */
import { MAP_QUERY } from '../../../common/areas/maps/constants.js';
import type { ModuleArea } from '../../areas.js';
import { previewMapImage, readMapImage } from './read.js';
import { uploadMapChunk } from './upload.js';

export const mapsArea: ModuleArea = {
  id: 'maps',
  queries: [
    { names: MAP_QUERY.uploadChunk, handler: uploadMapChunk },
    { names: MAP_QUERY.readImage, handler: readMapImage },
    { names: MAP_QUERY.previewImage, handler: previewMapImage },
  ],
};
