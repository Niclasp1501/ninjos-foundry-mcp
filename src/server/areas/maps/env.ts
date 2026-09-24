/**
 * What the image generator reads from the environment of the MCP server.
 *
 * The key lives only here, on the PC that runs the server: it is read at the
 * moment of a call, handed to the Gemini client and to nothing else. It is
 * never stored in a configuration object that could be logged, never sent to
 * Foundry (world settings reach every player's browser) and never part of a
 * URL, so it cannot turn up in a log line, a proxy or an error message.
 *
 * - GEMINI_API_KEY: switches the generator on. Without it the three tools are
 *   not listed at all.
 * - GEMINI_IMAGE_MODEL: default gemini-3.1-flash-image, the model that follows
 *   reference images and edit instructions.
 * - GEMINI_IMAGE_SIZE: 1K, 2K or 4K, default 2K. A 16:9 image in 2K is
 *   2752 x 1536 pixels, enough for a battle map.
 * - FOUNDRY_MCP_IMAGE_STYLE: a text that replaces the built-in style, or
 *   "none" for no style at all.
 * - GEMINI_TIMEOUT_MS: how long one request may take, default 180 seconds.
 */
export type Env = Readonly<Record<string, string | undefined>>;

export const IMAGE_SIZES = ['1K', '2K', '4K'] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

export const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image';
export const DEFAULT_IMAGE_SIZE: ImageSize = '2K';
export const DEFAULT_TIMEOUT_MS = 180_000;

export interface ImageEnv {
  apiKey: string;
  model: string;
  imageSize: ImageSize;
  /** null: the built-in style. "" (FOUNDRY_MCP_IMAGE_STYLE=none): no style text. */
  style: string | null;
  timeoutMs: number;
}

export function isImageSize(value: unknown): value is ImageSize {
  return typeof value === 'string' && (IMAGE_SIZES as readonly string[]).includes(value);
}

/** Letters, digits, dots and hyphens: a model name cannot change the URL it is put into. */
export function isModelName(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9.-]{0,79}$/.test(value);
}

function text(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

/** Whether a key is set. The core lists the tools only then. */
export function hasImageKey(env: Env): boolean {
  return text(env, 'GEMINI_API_KEY') !== undefined;
}

/** The settings of one call, or the problems that prevent it. Read anew for every call. */
export function readImageEnv(env: Env): { env: ImageEnv | null; problems: string[] } {
  const problems: string[] = [];
  const apiKey = text(env, 'GEMINI_API_KEY');
  if (!apiKey)
    problems.push(
      'GEMINI_API_KEY is not set for the MCP server. Put your own key from Google AI Studio into the env block of the server entry and restart your MCP program.'
    );

  const model = text(env, 'GEMINI_IMAGE_MODEL') ?? DEFAULT_IMAGE_MODEL;
  if (!isModelName(model))
    problems.push(
      `GEMINI_IMAGE_MODEL="${model}" is not a model name like "${DEFAULT_IMAGE_MODEL}".`
    );

  const rawSize = text(env, 'GEMINI_IMAGE_SIZE') ?? DEFAULT_IMAGE_SIZE;
  const imageSize = rawSize.toUpperCase();
  if (!isImageSize(imageSize))
    problems.push(`GEMINI_IMAGE_SIZE="${rawSize}" must be 1K, 2K or 4K.`);

  const rawTimeout = text(env, 'GEMINI_TIMEOUT_MS');
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (rawTimeout !== undefined) {
    const value = Number(rawTimeout);
    if (Number.isInteger(value) && value >= 10_000 && value <= 900_000) timeoutMs = value;
    else
      problems.push(`GEMINI_TIMEOUT_MS="${rawTimeout}" must be milliseconds from 10000 to 900000.`);
  }

  const rawStyle = text(env, 'FOUNDRY_MCP_IMAGE_STYLE');
  const style = rawStyle === undefined ? null : rawStyle.toLowerCase() === 'none' ? '' : rawStyle;

  if (problems.length || !apiKey || !isImageSize(imageSize)) return { env: null, problems };
  return { env: { apiKey, model, imageSize, style, timeoutMs }, problems };
}
