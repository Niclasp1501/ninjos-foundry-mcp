/**
 * The three image tools: generate-battlemap, generate-scene-image and
 * edit-map-image.
 *
 * One call does the whole way and answers when it is done:
 *
 * 1. read the references from Foundry (images in the data folder or the
 *    backgrounds of scenes), through the module;
 * 2. ask Gemini, with the key of this PC;
 * 3. store the image in Foundry's data folder, never over an existing file;
 * 4. create the scene through the query of the scenes area, so folders,
 *    templates and the permission check are the same as for create-scene;
 * 5. return a small preview, so the model can look at the result.
 *
 * Nothing is cached and nothing runs in the background: a failed call leaves
 * at most a stored image behind, and says so.
 */
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_ASPECT_RATIO,
  isAspectRatio,
  MAP_QUERY,
  safeDataDirectory,
  safeDataFile,
  safeFileName,
  UPLOAD_CHUNK_CHARS,
  UPLOAD_MAX_BYTES,
  withImageExtension,
  imageTypeOf,
  ASPECT_RATIOS,
  type AspectRatio,
} from '../../../common/areas/maps/constants.js';
import type { ToolAnnotations } from '../../control/api.js';
import type { ToolContent } from '../../control/api.js';
import type { ToolContext, ToolDefinition, ToolOutput } from '../../tools/types.js';
import { formatCreate } from '../scenes/format.js';
import { imageSize, nearestAspectRatio } from './dimensions.js';
import {
  IMAGE_SIZES,
  isImageSize,
  isModelName,
  readImageEnv,
  type Env,
  type ImageEnv,
} from './env.js';
import { isMissingQuery, MapsError, messageOf, moduleTooOldMessage } from './errors.js';
import { generateImage, type GeminiImage, type InlineImage } from './gemini.js';
import { battlemapPrompt, editPrompt, sceneImagePrompt } from './style.js';

/** At most this many references go to Gemini in one call. */
export const MAX_REFERENCES = 6;

export interface MapsDeps {
  /** The environment at the moment of the call; the key is read from it and nowhere else. */
  env(): Env;
  fetch: typeof fetch;
  newId(): string;
}

export const defaultMapsDeps: MapsDeps = {
  env: () => process.env,
  fetch: (input, init) => fetch(input, init),
  newId: () => randomUUID(),
};

type Args = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(message: string): MapsError {
  return new MapsError('INVALID_ARGUMENT', message, false);
}

function text(args: Args, key: string, required = false): string | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === '') {
    if (required) throw invalid(`${key} is required`);
    return undefined;
  }
  if (typeof value !== 'string' || !value.trim()) throw invalid(`${key} must be a text`);
  return value.trim();
}

function texts(args: Args, key: string): string[] {
  const value = args[key];
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((entry, index) => {
    if (typeof entry !== 'string' || !entry.trim())
      throw invalid(`${key}[${index}] must be a text`);
    return entry.trim();
  });
}

function flag(args: Args, key: string, fallback: boolean): boolean {
  const value = args[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw invalid(`${key} must be true or false`);
  return value;
}

function gridSize(args: Args): number | undefined {
  const value = args['grid_size'];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 20 || value > 400)
    throw invalid('grid_size must be a whole number of pixels from 20 to 400');
  return value;
}

function directoryArg(args: Args): string | null {
  const raw = text(args, 'directory');
  if (raw === undefined) return null;
  const directory = safeDataDirectory(raw);
  if (!directory)
    throw invalid(
      `directory must be a folder inside Foundry's data folder, like "Maps/Harbour", got "${raw}"`
    );
  return directory;
}

/** The settings of this call: the environment, and model or size when the call names them. */
function settingsFor(deps: MapsDeps, args: Args): ImageEnv {
  const { env, problems } = readImageEnv(deps.env());
  if (!env) throw new MapsError('NOT_CONFIGURED', problems.join(' '), false);
  const model = text(args, 'model');
  if (model !== undefined && !isModelName(model))
    throw invalid(`model "${model}" is not a model name like "gemini-3.1-flash-image"`);
  const size = text(args, 'image_size')?.toUpperCase();
  if (size !== undefined && !isImageSize(size)) throw invalid('image_size must be 1K, 2K or 4K');
  return { ...env, model: model ?? env.model, imageSize: size ?? env.imageSize };
}

function aspectArg(args: Args, fallback: AspectRatio): AspectRatio {
  const raw = text(args, 'aspect_ratio');
  if (raw === undefined) return fallback;
  if (!isAspectRatio(raw)) throw invalid(`aspect_ratio must be one of ${ASPECT_RATIOS.join(', ')}`);
  return raw;
}

async function ask(context: ToolContext, name: string, data: unknown): Promise<unknown> {
  try {
    return await context.query(name, data);
  } catch (error) {
    if (isMissingQuery(error))
      throw new MapsError('MODULE_TOO_OLD', moduleTooOldMessage(name, error), false);
    throw error;
  }
}

interface Reference extends InlineImage {
  /** The file inside the data folder. */
  path: string;
  label: string;
  bytes: Uint8Array;
}

async function readReference(
  context: ToolContext,
  target: { path: string } | { scene: string }
): Promise<Reference> {
  const answer = await ask(context, MAP_QUERY.readImage, target);
  if (
    !isRecord(answer) ||
    typeof answer['data'] !== 'string' ||
    typeof answer['mimeType'] !== 'string'
  )
    throw new MapsError('BAD_ANSWER', `The module sent no image for ${JSON.stringify(target)}`);
  const bytes = new Uint8Array(Buffer.from(answer['data'], 'base64'));
  const path = typeof answer['path'] === 'string' ? answer['path'] : '';
  const label = 'scene' in target ? `scene "${target.scene}" (${path})` : path;
  return { mimeType: answer['mimeType'], data: answer['data'], path, label, bytes };
}

async function readReferences(context: ToolContext, args: Args): Promise<Reference[]> {
  const scenes = texts(args, 'reference_scenes');
  const images = texts(args, 'reference_images');
  if (scenes.length + images.length > MAX_REFERENCES)
    throw invalid(
      `At most ${MAX_REFERENCES} references in one call, got ${scenes.length + images.length}`
    );
  const references: Reference[] = [];
  for (const scene of scenes) references.push(await readReference(context, { scene }));
  for (const image of images) {
    const path = safeDataFile(image);
    if (!path)
      throw invalid(`reference_images: "${image}" is not a path inside Foundry's data folder`);
    references.push(await readReference(context, { path }));
  }
  return references;
}

async function storeImage(
  context: ToolContext,
  deps: MapsDeps,
  image: GeminiImage,
  fileName: string,
  directory: string | null
): Promise<string> {
  const type = imageTypeOf(image.bytes);
  if (!type)
    throw new MapsError(
      'BAD_IMAGE',
      'Gemini returned an image that is not PNG, JPEG or WebP',
      false
    );
  if (image.bytes.byteLength > UPLOAD_MAX_BYTES)
    throw new MapsError(
      'TOO_LARGE',
      `The image has ${image.bytes.byteLength} bytes, more than ${UPLOAD_MAX_BYTES}`,
      false
    );
  const filename = withImageExtension(fileName, type);
  const data = Buffer.from(image.bytes).toString('base64');
  const total = Math.max(1, Math.ceil(data.length / UPLOAD_CHUNK_CHARS));
  const uploadId = deps.newId();
  let answer: unknown = null;
  for (let index = 0; index < total; index += 1) {
    answer = await ask(context, MAP_QUERY.uploadChunk, {
      uploadId,
      filename,
      index,
      total,
      data: data.slice(index * UPLOAD_CHUNK_CHARS, (index + 1) * UPLOAD_CHUNK_CHARS),
      ...(directory ? { directory } : {}),
    });
  }
  const path = isRecord(answer) ? answer['path'] : undefined;
  if (typeof path !== 'string' || !path)
    throw new MapsError(
      'UPLOAD_FAILED',
      `The module confirmed no stored file: ${JSON.stringify(answer)}`
    );
  return path;
}

async function previewOf(
  context: ToolContext,
  path: string
): Promise<{ content: ToolContent | null; note: string | null }> {
  try {
    const answer = await ask(context, MAP_QUERY.previewImage, { path });
    if (
      isRecord(answer) &&
      typeof answer['data'] === 'string' &&
      answer['mimeType'] === 'image/jpeg'
    )
      return {
        content: { type: 'image', data: answer['data'], mimeType: 'image/jpeg' },
        note: null,
      };
    return { content: null, note: 'The module sent no preview.' };
  } catch (error) {
    return { content: null, note: `No preview: ${messageOf(error)}` };
  }
}

function usageLine(settings: ImageEnv, image: GeminiImage): string {
  const tokens = image.usage.totalTokens;
  return (
    `Model ${settings.model}, size ${settings.imageSize}` +
    (tokens !== null ? `, ${tokens} tokens` : '') +
    '. Charged to the Google account of the key on this PC; see its usage in Google AI Studio.'
  );
}

async function generate(
  context: ToolContext,
  deps: MapsDeps,
  settings: ImageEnv,
  prompt: string,
  references: readonly Reference[],
  aspectRatio: AspectRatio
): Promise<GeminiImage> {
  context.progress({ progress: 1, total: 4, message: `Asking ${settings.model} for the image` });
  return generateImage({
    apiKey: settings.apiKey,
    model: settings.model,
    prompt,
    references,
    aspectRatio,
    imageSize: settings.imageSize,
    timeoutMs: settings.timeoutMs,
    ...(context.signal ? { signal: context.signal } : {}),
    fetch: deps.fetch,
  });
}

function finish(
  lines: string[],
  preview: { content: ToolContent | null; note: string | null }
): ToolOutput {
  const content: ToolContent[] = [{ type: 'text', text: lines.join('\n') }];
  if (preview.content) content.push(preview.content);
  else if (preview.note) content[0] = { type: 'text', text: [...lines, preview.note].join('\n') };
  return { content };
}

/** Annotations: writes the world, is not repeatable, and talks to Google. */
function imageTool(title: string): ToolAnnotations {
  return {
    title,
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  };
}

const referenceProperties = {
  reference_scenes: {
    type: 'array',
    items: { type: 'string' },
    description:
      'Scenes (id or name) whose background shows the same place, e.g. the location pictures outside and inside. ' +
      'Their images go to Gemini as references, so the result matches them. Strongly recommended when such pictures exist.',
  },
  reference_images: {
    type: 'array',
    items: { type: 'string' },
    description:
      'Further reference images as paths inside the Foundry data folder, e.g. "Maps/Harbour/SC_Harbour_Board.jpg" ' +
      'for a detail like a coat of arms. At most 6 references in total.',
  },
};

const storageProperties = {
  directory: {
    type: 'string',
    description:
      'Folder inside the Foundry data folder for the image, e.g. "Maps/Harbour/Tavern"; missing folders are created. ' +
      'Default: worlds/<world>/ai-generated-maps. An existing file is never replaced; the name gets a number.',
  },
  image_size: {
    type: 'string',
    enum: [...IMAGE_SIZES],
    description: 'Default from GEMINI_IMAGE_SIZE, normally 2K.',
  },
  model: { type: 'string', description: 'Gemini image model; default from GEMINI_IMAGE_MODEL.' },
};

const sceneProperties = {
  create_scene: {
    type: 'boolean',
    default: true,
    description: 'Create a scene from the image (default true).',
  },
  folder: {
    type: 'string',
    description: 'Scene folder path, nested with "/", created when missing.',
  },
  template_scene: {
    type: 'string',
    description:
      'Id or name of a scene whose settings the new scene copies (grid, lighting), like create-scene.',
  },
  navigation: {
    type: 'boolean',
    default: false,
    description: 'Show the scene in the navigation (default false).',
  },
};

const COST_NOTE =
  'Every call is a paid request to Google with the GEMINI_API_KEY of the PC that runs the MCP server ' +
  '(a few cents per image in 2K). Only call it when the user asked for an image.';

interface GenerateSpec {
  name: 'generate-battlemap' | 'generate-scene-image';
  title: string;
  description: string;
  prefix: 'BM' | 'SC';
  prompt: typeof battlemapPrompt;
  gridDefault: number;
}

function generateTool(spec: GenerateSpec, deps: MapsDeps): ToolDefinition {
  return {
    name: spec.name,
    title: spec.title,
    group: 'maps',
    description: spec.description,
    annotations: imageTool(spec.title),
    inputSchema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description:
            'What the picture shows, in English: the place, its layout and the important objects with where they stand. ' +
            'Be concrete; name what must be visible.',
        },
        name: {
          type: 'string',
          description: `Name of the scene. The file is named "${spec.prefix}_<name>" unless file_name is given.`,
        },
        file_name: {
          type: 'string',
          description: 'File name without extension; the extension follows the image.',
        },
        aspect_ratio: { type: 'string', enum: [...ASPECT_RATIOS], default: DEFAULT_ASPECT_RATIO },
        ...referenceProperties,
        ...storageProperties,
        ...sceneProperties,
        grid_size: {
          type: 'number',
          description: `Grid size in pixels for the scene; default ${spec.gridDefault}. Choose it so a chair covers about one square.`,
        },
      },
      required: ['description', 'name'],
    },
    handler: async (args, context) => {
      const settings = settingsFor(deps, args);
      const description = text(args, 'description', true) as string;
      const name = text(args, 'name', true) as string;
      const fileName = safeFileName(text(args, 'file_name') ?? `${spec.prefix}_${name}`);
      const aspectRatio = aspectArg(args, DEFAULT_ASPECT_RATIO);
      const directory = directoryArg(args);
      const createScene = flag(args, 'create_scene', true);
      const grid = gridSize(args) ?? spec.gridDefault;

      context.progress({ progress: 0, total: 4, message: 'Reading the references' });
      const references = await readReferences(context, args);
      const prompt = spec.prompt({
        description,
        aspectRatio,
        referenceCount: references.length,
        style: settings.style,
      });
      const image = await generate(context, deps, settings, prompt, references, aspectRatio);

      context.progress({ progress: 2, total: 4, message: 'Storing the image in Foundry' });
      const path = await storeImage(context, deps, image, fileName, directory);
      const size = imageSize(image.bytes, image.mimeType);
      const lines = [
        `Image stored: ${path}${size ? ` (${size.width} x ${size.height})` : ''}`,
        references.length
          ? `References: ${references.map(r => r.label).join('; ')}`
          : 'References: none',
        usageLine(settings, image),
      ];
      if (image.text) lines.push(`Gemini said: ${image.text}`);

      if (createScene) {
        context.progress({ progress: 3, total: 4, message: 'Creating the scene' });
        const folder = text(args, 'folder');
        const template = text(args, 'template_scene');
        try {
          const answer = await ask(context, 'createScene', {
            name,
            background: path,
            gridSize: grid,
            navigation: flag(args, 'navigation', false),
            ...(folder ? { folderPath: folder } : {}),
            ...(template ? { templateName: template } : {}),
          });
          lines.push('', formatCreate(answer) ?? `Scene answer: ${JSON.stringify(answer)}`);
        } catch (error) {
          lines.push('', `The image is stored, but the scene was not created: ${messageOf(error)}`);
        }
      }
      return finish(lines, await previewOf(context, path));
    },
  };
}

function editTool(deps: MapsDeps): ToolDefinition {
  const title = 'Edit map image';
  return {
    name: 'edit-map-image',
    title,
    group: 'maps',
    description:
      'Change an existing image in Foundry with Gemini, e.g. remove an object, move a door or fix a detail, and store the ' +
      'result as a new file next to it; the original stays. Gemini repaints the whole picture on every edit, so small ' +
      'details such as coats of arms and fine lines get softer with each round: bundle all changes into one instruction, ' +
      'and after several rounds generate the picture anew with the edited image as a reference instead. ' +
      'Give a reference image for any detail that must look a certain way. ' +
      COST_NOTE,
    annotations: imageTool(title),
    inputSchema: {
      type: 'object',
      properties: {
        instruction: {
          type: 'string',
          description:
            'The changes, in English, precise about place and look, e.g. "Remove the spear leaning against the hearth; ' +
            'the floor there becomes plain flagstones."',
        },
        source_path: {
          type: 'string',
          description: 'The image to edit, as a path inside the Foundry data folder.',
        },
        source_scene: {
          type: 'string',
          description: 'Or: the scene (id or name) whose background is edited.',
        },
        file_name: {
          type: 'string',
          description:
            'File name of the result without extension; default the original name with "_edit".',
        },
        aspect_ratio: {
          type: 'string',
          enum: [...ASPECT_RATIOS],
          description: 'Default: the ratio of the original.',
        },
        replace_scene_background: {
          type: 'string',
          description:
            'A scene (id or name) that gets the result as its new background. Without it no scene changes.',
        },
        ...referenceProperties,
        ...storageProperties,
      },
      required: ['instruction'],
    },
    handler: async (args, context) => {
      const settings = settingsFor(deps, args);
      const instruction = text(args, 'instruction', true) as string;
      const sourcePath = text(args, 'source_path');
      const sourceScene = text(args, 'source_scene');
      if (!sourcePath === !sourceScene)
        throw invalid('Give exactly one of source_path or source_scene');
      let target: { path: string } | { scene: string };
      if (sourcePath) {
        const path = safeDataFile(sourcePath);
        if (!path)
          throw invalid(`source_path "${sourcePath}" is not a path inside Foundry's data folder`);
        target = { path };
      } else target = { scene: sourceScene as string };

      context.progress({ progress: 0, total: 4, message: 'Reading the image and the references' });
      const source = await readReference(context, target);
      const references = await readReferences(context, args);
      const sourceFile = source.path;
      const cut = sourceFile.lastIndexOf('/');
      const directory =
        directoryArg(args) ?? (cut > 0 ? safeDataDirectory(sourceFile.slice(0, cut)) : null);
      const sourceBase = sourceFile.slice(cut + 1).replace(/\.[^.]+$/, '');
      const fileName = safeFileName(text(args, 'file_name') ?? `${sourceBase}_edit`);
      const aspectRatio = aspectArg(
        args,
        nearestAspectRatio(imageSize(source.bytes, source.mimeType))
      );

      const prompt = editPrompt({ instruction, referenceCount: references.length });
      const image = await generate(
        context,
        deps,
        settings,
        prompt,
        [source, ...references],
        aspectRatio
      );

      context.progress({ progress: 2, total: 4, message: 'Storing the image in Foundry' });
      const path = await storeImage(context, deps, image, fileName, directory);
      const size = imageSize(image.bytes, image.mimeType);
      const lines = [
        `Edited image stored: ${path}${size ? ` (${size.width} x ${size.height})` : ''}`,
        `Original, unchanged: ${sourceFile}`,
        references.length
          ? `References: ${references.map(r => r.label).join('; ')}`
          : 'References: none',
        usageLine(settings, image),
      ];
      if (image.text) lines.push(`Gemini said: ${image.text}`);

      const replace = text(args, 'replace_scene_background');
      if (replace) {
        context.progress({ progress: 3, total: 4, message: 'Setting the scene background' });
        try {
          await ask(context, 'updateScene', { sceneIdentifier: replace, background: path });
          lines.push(`Scene "${replace}" now shows ${path}.`);
        } catch (error) {
          lines.push(`The scene "${replace}" was not changed: ${messageOf(error)}`);
        }
      }
      return finish(lines, await previewOf(context, path));
    },
  };
}

export function mapTools(deps: MapsDeps = defaultMapsDeps): ToolDefinition[] {
  return [
    generateTool(
      {
        name: 'generate-battlemap',
        title: 'Generate battle map',
        prefix: 'BM',
        prompt: battlemapPrompt,
        gridDefault: 100,
        description:
          'Paint a top-down battle map with Gemini in the house style, store it in Foundry and create a scene from it ' +
          '(not activated). The map shows the place from straight above in neutral daylight, without grid, frame or ' +
          'figures; set the time of day in Foundry. Give reference_scenes with the location pictures of the same place, ' +
          'so the map matches them. The answer carries a preview; look at it and fix mistakes with edit-map-image. ' +
          COST_NOTE,
      },
      deps
    ),
    generateTool(
      {
        name: 'generate-scene-image',
        title: 'Generate scene image',
        prefix: 'SC',
        prompt: sceneImagePrompt,
        gridDefault: 100,
        description:
          'Paint a location picture with Gemini in the house style: the view of a person standing in the place, at eye ' +
          'level, without people or creatures. Stores it in Foundry and creates a scene from it (not activated). Name the ' +
          'light and time of day in the description. Give reference_scenes, e.g. the battle map of the place, so the ' +
          'picture shows the same room with everything where it stands on the map. The answer carries a preview. ' +
          COST_NOTE,
      },
      deps
    ),
    editTool(deps),
  ];
}
