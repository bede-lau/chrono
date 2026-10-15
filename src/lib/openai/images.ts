/**
 * Server-only OpenAI image-edit adapter used in place of Tessa's skin pass.
 *
 * The public function intentionally returns a small, normalized PNG so the
 * rest of the organism pipeline keeps the same image contract as before.
 */
import { decodePng, encodePng, pngDataUrl, type RGBAImage } from "../imaging";

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/edits";
const DEFAULT_MODEL = "gpt-image-2.5-flare";
const DEFAULT_TIMEOUT_MS = 180_000;
const MODEL_INPUT_SIZE = 256;
const MODEL_OUTPUT_SIZE = 1024;
const MAX_SEED_PNG_BYTES = 1 * 1024 * 1024;
const MAX_OUTPUT_PNG_BYTES = 12 * 1024 * 1024;
const MAX_OUTPUT_BASE64_CHARS = Math.ceil(MAX_OUTPUT_PNG_BYTES / 3) * 4;
const MAX_OUTPUT_EDGE = 4096;
const MAX_OUTPUT_PIXELS = 8_388_608;

export type OpenAIImageErrorCode =
  | "missing_key"
  | "invalid_input"
  | "aborted"
  | "timeout"
  | "authentication"
  | "quota"
  | "rate_limit"
  | "provider_failure"
  | "output_decoding";

/** An error safe to present to an end user; it never includes an upstream body. */
export class OpenAIImageError extends Error {
  readonly code: OpenAIImageErrorCode;
  readonly requestId?: string;

  constructor(code: OpenAIImageErrorCode, message: string, requestId?: string) {
    super(message);
    this.name = "OpenAIImageError";
    this.code = code;
    this.requestId = requestId;
  }
}

export interface OpenAIImageEditOptions {
  /** Injectable for offline request/response verification. */
  fetchImpl?: typeof fetch;
  /** A caller cancellation signal, for example from a route handler. */
  signal?: AbortSignal;
  /** Test-only transport deadline override. API keys always come from the server environment. */
  timeoutMs?: number;
}

export interface OpenAIImageEditResult {
  png: Uint8Array;
  model: string;
  requestId?: string;
}

type ImagesEditResponse = {
  data?: Array<{ b64_json?: unknown }>;
};

const membranePrompt = [
  "Edit this reference into a flat, seamless equirectangular organism membrane texture.",
  "Preserve the reference image's cell layout, color palette, cell boundaries, and local variation.",
  "Add subtle biological texture and translucent membrane detail only within those cells.",
  "Return only the texture: no sphere, no lighting, no cast shadow, no text, no frame, no background objects, and no new subject.",
  "Keep the image tileable at its left and right edges.",
].join(" ");

function nearestUpscale(source: RGBAImage, targetSize: number): RGBAImage {
  const data = new Uint8ClampedArray(targetSize * targetSize * 4);
  for (let y = 0; y < targetSize; y++) {
    const sy = Math.min(source.height - 1, Math.floor((y * source.height) / targetSize));
    for (let x = 0; x < targetSize; x++) {
      const sx = Math.min(source.width - 1, Math.floor((x * source.width) / targetSize));
      const from = (sy * source.width + sx) * 4;
      const to = (y * targetSize + x) * 4;
      data[to] = source.data[from];
      data[to + 1] = source.data[from + 1];
      data[to + 2] = source.data[from + 2];
      data[to + 3] = source.data[from + 3];
    }
  }
  return { width: targetSize, height: targetSize, data };
}

/** Area-resample RGB and deliberately carry the input alpha into the final texture. */
function downsampleToSeed(generated: RGBAImage, seed: RGBAImage): RGBAImage {
  const data = new Uint8ClampedArray(seed.width * seed.height * 4);
  for (let y = 0; y < seed.height; y++) {
    const y0 = Math.floor((y * generated.height) / seed.height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * generated.height) / seed.height));
    for (let x = 0; x < seed.width; x++) {
      const x0 = Math.floor((x * generated.width) / seed.width);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * generated.width) / seed.width));
      let red = 0;
      let green = 0;
      let blue = 0;
      let count = 0;
      for (let sy = y0; sy < Math.min(y1, generated.height); sy++) {
        for (let sx = x0; sx < Math.min(x1, generated.width); sx++) {
          const index = (sy * generated.width + sx) * 4;
          red += generated.data[index];
          green += generated.data[index + 1];
          blue += generated.data[index + 2];
          count++;
        }
      }
      const to = (y * seed.width + x) * 4;
      data[to] = Math.round(red / count);
      data[to + 1] = Math.round(green / count);
      data[to + 2] = Math.round(blue / count);
      data[to + 3] = seed.data[to + 3];
    }
  }
  return { width: seed.width, height: seed.height, data };
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function errorForStatus(status: number, errorCode: string | undefined, requestId?: string): OpenAIImageError {
  if (status === 401 || status === 403) {
    return new OpenAIImageError("authentication", "OpenAI rejected the image-generation API key.", requestId);
  }
  if (status === 402 || errorCode === "insufficient_quota") {
    return new OpenAIImageError("quota", "OpenAI image generation has no available quota.", requestId);
  }
  if (status === 429) {
    return new OpenAIImageError("rate_limit", "OpenAI image generation is temporarily rate limited.", requestId);
  }
  return new OpenAIImageError("provider_failure", "OpenAI could not create the organism texture.", requestId);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

/** Validate the PNG header before asking the decoder to allocate its pixel plane. */
function checkedPngShape(
  bytes: Uint8Array,
  maxBytes: number,
  maxEdge: number,
  maxPixels: number,
): { width: number; height: number } {
  if (bytes.byteLength < 24 || bytes.byteLength > maxBytes) throw new Error("PNG payload size");
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let index = 0; index < signature.length; index++) {
    if (bytes[index] !== signature[index]) throw new Error("PNG signature");
  }
  if (readU32(bytes, 8) !== 13 || String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") {
    throw new Error("PNG IHDR");
  }
  const width = readU32(bytes, 16);
  const height = readU32(bytes, 20);
  if (width < 1 || height < 1 || width > maxEdge || height > maxEdge || width * height > maxPixels) {
    throw new Error("PNG dimensions");
  }
  return { width, height };
}

function safeUpstreamErrorCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { code?: unknown; type?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code : candidate.type;
  return typeof code === "string" ? code : undefined;
}

function combinedSignal(signal: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  release: () => void;
  timedOut: () => boolean;
} {
  const controller = new AbortController();
  let timeout = false;
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timeout = true;
    controller.abort(new DOMException("OpenAI image request timed out", "TimeoutError"));
  }, timeoutMs);
  return {
    signal: controller.signal,
    release: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortFromCaller);
    },
    timedOut: () => timeout,
  };
}

/**
 * Turns the Colony PNG into a textured membrane image using one OpenAI Images
 * edit request. This module is server-only because it reads OPENAI_API_KEY.
 */
export async function editOrganismMembrane(
  seedPng: Uint8Array,
  options: OpenAIImageEditOptions = {},
): Promise<OpenAIImageEditResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new OpenAIImageError("missing_key", "Set OPENAI_API_KEY to generate the organism membrane.");
  }

  let seed: RGBAImage;
  try {
    checkedPngShape(seedPng, MAX_SEED_PNG_BYTES, 64, 4_096);
    seed = decodePng(seedPng);
  } catch {
    throw new OpenAIImageError("invalid_input", "The organism seed must be a valid PNG image.");
  }
  if (seed.width < 1 || seed.height < 1 || seed.width > 64 || seed.height > 64) {
    throw new OpenAIImageError("invalid_input", "The organism seed must be between 1 and 64 pixels in each dimension.");
  }

  const model = process.env.OPENAI_IMAGE_MODEL?.trim() || DEFAULT_MODEL;
  const imageUrl = pngDataUrl(encodePng(nearestUpscale(seed, MODEL_INPUT_SIZE)));
  const requestBody = {
    model,
    images: [{ image_url: imageUrl }],
    prompt: membranePrompt,
    background: "opaque",
    output_format: "png",
    quality: "low",
    size: `${MODEL_OUTPUT_SIZE}x${MODEL_OUTPUT_SIZE}`,
    n: 1,
  };

  const bounded = combinedSignal(options.signal, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let response: Response;
  try {
    try {
      response = await (options.fetchImpl ?? fetch)(OPENAI_IMAGES_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: bounded.signal,
      });
    } catch {
      if (bounded.timedOut()) {
        throw new OpenAIImageError("timeout", "OpenAI image generation did not finish within three minutes.");
      }
      if (options.signal?.aborted) {
        throw new OpenAIImageError("aborted", "OpenAI image generation was cancelled.");
      }
      throw new OpenAIImageError("provider_failure", "OpenAI image generation could not be reached.");
    }

    const requestId = response.headers.get("x-request-id") ?? undefined;
    if (!response.ok) {
      let errorCode: string | undefined;
      try {
        errorCode = safeUpstreamErrorCode(await response.json());
      } catch {
        // The HTTP status remains enough to return a safe, actionable error.
      }
      if (bounded.timedOut()) {
        throw new OpenAIImageError("timeout", "OpenAI image generation did not finish within three minutes.", requestId);
      }
      throw errorForStatus(response.status, errorCode, requestId);
    }

    let payload: ImagesEditResponse;
    try {
      payload = (await response.json()) as ImagesEditResponse;
    } catch {
      if (bounded.timedOut()) {
        throw new OpenAIImageError("timeout", "OpenAI image generation did not finish within three minutes.", requestId);
      }
      throw new OpenAIImageError("output_decoding", "OpenAI returned an unreadable image response.", requestId);
    }
    const encoded = payload.data?.[0]?.b64_json;
    if (typeof encoded !== "string" || encoded.length === 0 || encoded.length > MAX_OUTPUT_BASE64_CHARS) {
      throw new OpenAIImageError("output_decoding", "OpenAI returned an invalid image payload.", requestId);
    }

    try {
      const outputBytes = base64ToBytes(encoded);
      checkedPngShape(outputBytes, MAX_OUTPUT_PNG_BYTES, MAX_OUTPUT_EDGE, MAX_OUTPUT_PIXELS);
      const output = decodePng(outputBytes);
      return { png: encodePng(downsampleToSeed(output, seed)), model, requestId };
    } catch {
      throw new OpenAIImageError("output_decoding", "OpenAI returned an invalid PNG image.", requestId);
    }
  } finally {
    bounded.release();
  }
}
