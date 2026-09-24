/**
 * The house style and the prompts of the three image tools.
 *
 * STYLE_CORE is the style of Ninjo's campaign pictures ("Crisp Hybrid"), word
 * for word as in his image tool, so maps from this module match the location
 * pictures made there. FOUNDRY_MCP_IMAGE_STYLE replaces it, "none" leaves it
 * out. Only the framing differs between the tools:
 *
 * - battle map: a strict top-down plan in neutral daylight, because the time
 *   of day is set later in Foundry, and without grid, frame or figures;
 * - scene image: the eye-level view of a person standing in the place;
 * - edit: only the named changes, everything else kept.
 *
 * What the wording guards against was learned on real maps: the model draws
 * facades and chimneys in perspective unless every vertical surface is ruled
 * out, fills the frame with a dark vignette unless told otherwise, and copies
 * the perspective of eye-level references unless told to take only their
 * furnishings and materials.
 */
import type { AspectRatio } from '../../../common/areas/maps/constants.js';

export const STYLE_CORE =
  'rendered in an advanced illustrative animation style that combines 3D form with ' +
  'subtle, clean 2D hand-painted textures. The finish is clean and polished like a ' +
  'background painting from a modern animated fantasy film: every shape has a crisp, ' +
  'thin dark contour, shading is smooth, and there are no loose sketchy strokes, no ' +
  'visible canvas texture and no outlined or scribbled clouds. The aesthetic balances a ' +
  'mature fantasy look with a crisp and clear atmosphere, avoiding murky, washed-out, ' +
  'or overly comic-like elements. Shapes and structures are sharply defined with ' +
  'elegant, thin contours, completely eliminating any cartoonish cel-shading or thick ' +
  'borders. The lighting suits the scene and its time of day, whether daylight, golden ' +
  'evening, lantern light or night, and always shows the textures clearly without ' +
  'creating soft, blurry, or cloudy fog. The image is entirely textless; no text, ' +
  'writing, labels, watermarks, or signatures are visible anywhere, unless a specific ' +
  'script is explicitly requested in the motif.';

const WIDE_NOTE =
  'The image is composed as an ultrawide cinematic landscape with extended space on the ' +
  'left and right sides for custom cropping.';

const BATTLEMAP_VIEW =
  'This is a true orthographic plan view, like a professional virtual tabletop battle map, seen ' +
  'from exactly straight above. No vertical surface is visible anywhere: every wall appears only ' +
  'as a flat band showing its top edge, furniture, barrels and posts appear only as their ' +
  'top-down outlines, and trees only as round crowns. There is no facade, no front view and no ' +
  'three-quarter angle. All furniture has realistic proportions, and a person could walk between ' +
  'the tables.';

const BATTLEMAP_LIGHT =
  'Unless the description asks for other lighting, the map is in bright, neutral daylight and ' +
  'easy to read, because the time of day is set later in the virtual tabletop.';

function battlemapFrame(ratio: AspectRatio): string {
  return (
    `The image is a ${ratio} composition in which the map fills the entire frame and extends to ` +
    'all four edges; there is no dark vignette and no empty margin. There is no grid, no grid ' +
    'lines, no border, no frame, no compass rose, no scale bar and no legend. The map is completely ' +
    'empty of characters, creatures, figures and tokens.'
  );
}

const SCENE_VIEW =
  'The view is at eye level, as a person standing on the ground a short distance away would see ' +
  'the place, never from above. The entire scene is completely desolate and uninhabited; there are ' +
  'absolutely no characters, humans, figures, or creatures present.';

/** How the references are meant, placed right after the description. */
function referenceNote(count: number, eyeLevelTarget: boolean): string {
  if (count === 0) return '';
  const which = count === 1 ? 'The attached image shows' : `The ${count} attached images show`;
  return eyeLevelTarget
    ? `${which} the same place. Follow them closely for the layout, furnishings, materials, colours ` +
        'and mood, so the new picture clearly shows the same place.'
    : `${which} the same place, mostly at eye level. Follow them for the furnishings, materials, ` +
        'colours and details, but never copy their perspective.';
}

function style(custom: string | null): string {
  if (custom === null) return STYLE_CORE;
  return custom;
}

function join(...parts: string[]): string {
  return parts
    .map(part => part.trim())
    .filter(Boolean)
    .join(' ');
}

export interface PromptInput {
  description: string;
  aspectRatio: AspectRatio;
  referenceCount: number;
  /** null: the built-in style, "": none, otherwise the replacement. */
  style: string | null;
}

export function battlemapPrompt(input: PromptInput): string {
  return join(
    `Top-down battle map of ${input.description.trim().replace(/[.s]+$/, '')}.`,
    referenceNote(input.referenceCount, false),
    BATTLEMAP_VIEW,
    BATTLEMAP_LIGHT,
    style(input.style),
    battlemapFrame(input.aspectRatio)
  );
}

export function sceneImagePrompt(input: PromptInput): string {
  return join(
    `${input.description.trim().replace(/[.s]+$/, '')},`,
    style(input.style),
    input.aspectRatio === '21:9' ? WIDE_NOTE : '',
    referenceNote(input.referenceCount, true),
    SCENE_VIEW
  );
}

export interface EditInput {
  instruction: string;
  /** References after the image to edit. */
  referenceCount: number;
}

export function editPrompt(input: EditInput): string {
  const references =
    input.referenceCount === 0
      ? ''
      : input.referenceCount === 1
        ? 'The second attached image is a reference for the change only; copy nothing else from it.'
        : 'The further attached images are references for the change only; copy nothing else from them.';
  return join(
    'Edit the first attached image. Keep everything that the instruction does not name exactly as it ' +
      'is: the layout, every object, the perspective, the light, the colours and the rendering style. ' +
      'Make only this change:',
    input.instruction.trim(),
    references,
    'No text, no characters and no creatures are added.'
  );
}
