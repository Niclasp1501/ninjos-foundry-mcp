/**
 * One image from Gemini.
 *
 * The key travels in the header `x-goog-api-key`, never in the URL, so it
 * cannot appear in a log of a proxy or in an error that quotes the address.
 * Every text that leaves this file passes `redact`, in case Google ever
 * repeats the key in an answer.
 *
 * References come before the text, in the order given, as the model reads
 * "the first attached image" in that order. The aspect ratio and the size go
 * as real parameters: asked for only in the prompt, the model does not keep
 * to them reliably.
 */
import type { AspectRatio } from '../../../common/areas/maps/constants.js';
import type { ImageSize } from './env.js';
import { MapsError } from './errors.js';

export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface InlineImage {
  mimeType: string;
  /** base64 */
  data: string;
}

export interface GeminiImageRequest {
  apiKey: string;
  model: string;
  prompt: string;
  references: readonly InlineImage[];
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
  timeoutMs: number;
  signal?: AbortSignal;
  fetch: typeof fetch;
}

export interface GeminiUsage {
  promptTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface GeminiImage {
  bytes: Uint8Array;
  mimeType: string;
  /** Text the model sent along with the image, if any. */
  text: string | null;
  usage: GeminiUsage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The text with every occurrence of the key replaced. */
export function redact(text: string, apiKey: string): string {
  return apiKey ? text.split(apiKey).join('[key]') : text;
}

function numberOr(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function googleMessage(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    const error = isRecord(parsed) ? parsed['error'] : undefined;
    if (isRecord(error) && typeof error['message'] === 'string') return error['message'];
  } catch {
    // Not JSON; the start of the text says enough.
  }
  return body.slice(0, 300).trim();
}

function failure(status: number, message: string): MapsError {
  if (status === 400 && /api key/i.test(message))
    return new MapsError(
      'KEY_REJECTED',
      `Google rejected the API key: ${message}. Check GEMINI_API_KEY of the MCP server.`,
      false
    );
  if (status === 401 || status === 403)
    return new MapsError(
      'KEY_REJECTED',
      `Google refused the request (HTTP ${status}): ${message}. The key may be wrong, restricted to other APIs, or the Generative Language API is not enabled for its project.`,
      false
    );
  if (status === 429)
    return new MapsError(
      'QUOTA',
      `Google's limit for this key is reached (HTTP 429): ${message}. Wait, or check the quota and budget of the key in Google AI Studio and Google Cloud.`,
      false
    );
  if (status === 404)
    return new MapsError(
      'MODEL_UNKNOWN',
      `Google does not know the model (HTTP 404): ${message}. Check GEMINI_IMAGE_MODEL.`,
      false
    );
  if (status >= 500)
    return new MapsError(
      'UNAVAILABLE',
      `Gemini is not available right now (HTTP ${status}): ${message}`
    );
  return new MapsError(
    'REQUEST_FAILED',
    `Gemini refused the request (HTTP ${status}): ${message}`,
    false
  );
}

function base64Bytes(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data, 'base64'));
}

export async function generateImage(request: GeminiImageRequest): Promise<GeminiImage> {
  const url = `${GEMINI_ENDPOINT}/${encodeURIComponent(request.model)}:generateContent`;
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          ...request.references.map(image => ({
            inlineData: { mimeType: image.mimeType, data: image.data },
          })),
          { text: request.prompt },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: request.aspectRatio, imageSize: request.imageSize },
    },
  };

  const timeout = AbortSignal.timeout(request.timeoutMs);
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await request.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': request.apiKey },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (request.signal?.aborted)
      throw new MapsError('CANCELLED', 'The request was cancelled', false);
    if (timeout.aborted)
      throw new MapsError(
        'TIMEOUT',
        `Gemini did not answer within ${Math.round(request.timeoutMs / 1000)} seconds (GEMINI_TIMEOUT_MS)`
      );
    const cause = error instanceof Error ? error.message : String(error);
    throw new MapsError('NETWORK', redact(`Gemini could not be reached: ${cause}`, request.apiKey));
  }

  const raw = await response.text();
  if (!response.ok) {
    const error = failure(response.status, redact(googleMessage(raw), request.apiKey));
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MapsError('BAD_ANSWER', 'Gemini answered with something that is not JSON');
  }
  const answer = isRecord(parsed) ? parsed : {};
  const usageRaw = isRecord(answer['usageMetadata']) ? answer['usageMetadata'] : {};
  const usage: GeminiUsage = {
    promptTokens: numberOr(usageRaw['promptTokenCount']),
    outputTokens: numberOr(usageRaw['candidatesTokenCount']),
    totalTokens: numberOr(usageRaw['totalTokenCount']),
  };

  const feedback = isRecord(answer['promptFeedback']) ? answer['promptFeedback'] : {};
  if (typeof feedback['blockReason'] === 'string')
    throw new MapsError(
      'BLOCKED',
      `Gemini refused the prompt (${feedback['blockReason']}). Describe the picture differently.`,
      false
    );

  const candidates = Array.isArray(answer['candidates']) ? answer['candidates'] : [];
  const first = isRecord(candidates[0]) ? candidates[0] : {};
  const content = isRecord(first['content']) ? first['content'] : {};
  const parts = Array.isArray(content['parts']) ? content['parts'].filter(isRecord) : [];
  const texts = parts
    .map(part => (typeof part['text'] === 'string' ? part['text'].trim() : ''))
    .filter(Boolean);
  const text = texts.length ? redact(texts.join('\n'), request.apiKey).slice(0, 1000) : null;

  for (const part of parts) {
    const inline = isRecord(part['inlineData'])
      ? part['inlineData']
      : isRecord(part['inline_data'])
        ? part['inline_data']
        : null;
    const data = inline?.['data'];
    if (typeof data !== 'string' || !data) continue;
    const mimeType = inline?.['mimeType'] ?? inline?.['mime_type'];
    return {
      bytes: base64Bytes(data),
      mimeType: typeof mimeType === 'string' ? mimeType : 'image/png',
      text,
      usage,
    };
  }

  const reason = typeof first['finishReason'] === 'string' ? first['finishReason'] : 'none given';
  throw new MapsError(
    reason === 'STOP' ? 'NO_IMAGE' : 'BLOCKED',
    `Gemini returned no image (finish reason ${reason})${text ? `. It said: ${text}` : ''}`,
    reason === 'STOP'
  );
}
