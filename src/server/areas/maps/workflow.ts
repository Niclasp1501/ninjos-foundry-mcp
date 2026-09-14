/**
 * The ComfyUI workflow for one battle map.
 *
 * Built from ComfyUI's standard nodes. The image ends in a preview node, so
 * ComfyUI writes it into its temporary folder, which it clears on its next
 * start, instead of its output folder, where the previous generation left
 * every map behind.
 */
import { MapsError } from './errors.js';

export const OUTPUT_NODE = '8';

/** Added in front of the description: the trigger of the battle map model and the view. */
export const PROMPT_PREFIX = '2d DnD battlemap, top-down view, overhead map';

export const NEGATIVE_PROMPT =
  'grid, grid lines, square grid, isometric, perspective, angled view, 3d render, text, letters, ' +
  'numbers, watermark, signature, logo, characters, people, person, creatures, monsters, animals, ' +
  'tokens, miniatures, blurry';

export interface ChosenModels {
  checkpoint: string;
  /** null: the checkpoint's own VAE is used. */
  vae: string | null;
  notes: string[];
}

/**
 * The battle map checkpoint and the SDXL VAE among what ComfyUI offers.
 * Checked before the job is queued, with every file name in the error, so a
 * missing model is not found out after minutes (the previous generation
 * did not check beforehand).
 */
export function chooseModels(checkpoints: string[], vaes: string[]): ChosenModels {
  const checkpoint = checkpoints.find(name => /battle[\s_-]*maps?/i.test(name));
  if (!checkpoint) {
    throw new MapsError(
      'MODEL_MISSING',
      `ComfyUI has no battle map checkpoint (a file whose name contains "battlemap"). Checkpoints found: ${
        checkpoints.length ? checkpoints.join(', ') : 'none'
      }.`,
      false
    );
  }
  const vae =
    vaes.find(name => /sdxl/i.test(name) && /vae/i.test(name)) ??
    vaes.find(name => /sdxl/i.test(name)) ??
    null;
  const notes = vae
    ? []
    : [
        `No SDXL VAE found in ComfyUI (VAE files: ${vaes.length ? vaes.join(', ') : 'none'}); the checkpoint's own VAE is used.`,
      ];
  return { checkpoint, vae, notes };
}

export function enhancedPrompt(prompt: string): string {
  return `${PROMPT_PREFIX}, ${prompt}`;
}

export interface GraphInput {
  prompt: string;
  models: ChosenModels;
  width: number;
  height: number;
  steps: number;
  seed: number;
}

export type ComfyGraph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

export function buildGraph(input: GraphInput): ComfyGraph {
  const graph: ComfyGraph = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: input.models.checkpoint } },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { text: enhancedPrompt(input.prompt), clip: ['1', 1] },
    },
    '4': { class_type: 'CLIPTextEncode', inputs: { text: NEGATIVE_PROMPT, clip: ['1', 1] } },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { width: input.width, height: input.height, batch_size: 1 },
    },
    '6': {
      class_type: 'KSampler',
      inputs: {
        seed: input.seed,
        steps: input.steps,
        cfg: 7,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        model: ['1', 0],
        positive: ['3', 0],
        negative: ['4', 0],
        latent_image: ['5', 0],
      },
    },
    '7': {
      class_type: 'VAEDecode',
      inputs: { samples: ['6', 0], vae: input.models.vae ? ['2', 0] : ['1', 2] },
    },
    [OUTPUT_NODE]: { class_type: 'PreviewImage', inputs: { images: ['7', 0] } },
  };
  if (input.models.vae)
    graph['2'] = { class_type: 'VAELoader', inputs: { vae_name: input.models.vae } };
  return graph;
}

/** A random seed in the range ComfyUI accepts. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 48);
}
