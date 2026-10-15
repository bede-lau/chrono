/** Server-only compatibility adapter: OpenAI image edits behind the existing skin-job contract. */
import { AtlasClient, readServerEnv, configuredMothBase } from "../moth/atlas";
import { ID_RE, MAX_UPLOAD_BYTES } from "../moth/engines";
import { MothError, abortError } from "../moth/errors";
import type { MothJobResult, MothJobStatus, MothOutput } from "../moth/transport";
import { editOrganismMembrane, OpenAIImageError, type OpenAIImageEditResult } from "./images";

const PREFIX = "oai1_";
const RECEIPT_LIFETIME_MS = 7 * 24 * 60 * 60_000;
const MAX_RECEIPT_LENGTH = 2048;
const encoder = new TextEncoder();

interface Receipt {
  v: 1;
  asset: string;
  bytes: number;
  submitted: number;
  completed: number;
  expires: number;
  scope: string;
  model: string;
  requestId?: string;
}

type ImageAtlas = Pick<AtlasClient, "fetchAsset" | "uploadAsset">;
interface SubmitOptions {
  /** Injection points for offline verification, never populated from browser request data. */
  edit?: (seed: Uint8Array, opts: { signal?: AbortSignal }) => Promise<OpenAIImageEditResult>;
}

function signingSecret(): string {
  const secret = process.env.OPENAI_IMAGE_JOB_SECRET;
  if (!secret || secret.length < 32) {
    throw new MothError({ status: 503, type: "openai_not_configured", message: "OpenAI membrane generation is not configured on this server.", retryable: false });
  }
  return secret;
}

async function signingKey() {
  return crypto.subtle.importKey("raw", encoder.encode(signingSecret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function toBase64Url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}

async function credentialScope(request: Request): Promise<string> {
  const authorization = request.headers.get("authorization");
  let apiKey: string;
  if (authorization !== null) {
    const match = /^Bearer\s+(.+?)\s*$/i.exec(authorization);
    if (!match?.[1]?.trim()) throw new MothError({ status: 400, type: "bad_authorization", message: "Authorization must contain a Bearer credential", retryable: false });
    apiKey = match[1].trim();
  } else {
    apiKey = readServerEnv().apiKey;
  }
  const scope = await crypto.subtle.sign("HMAC", await signingKey(), encoder.encode(`chrono-openai-scope-v1:${configuredMothBase()}:${apiKey}`));
  return toBase64Url(new Uint8Array(scope));
}

function unavailable(): MothError {
  return new MothError({ status: 404, type: "openai_job_not_found", message: "This image job is unavailable for the current credential.", retryable: false });
}

export function isOpenAIImageJob(jobId: string): boolean {
  return jobId.startsWith(PREFIX);
}

async function signReceipt(receipt: Receipt): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify(receipt)));
  const signature = await crypto.subtle.sign("HMAC", await signingKey(), encoder.encode(`${PREFIX}${payload}`));
  return `${PREFIX}${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

async function readReceipt(request: Request, jobId: string): Promise<Receipt> {
  if (jobId.length > MAX_RECEIPT_LENGTH) throw unavailable();
  const match = /^oai1_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(jobId);
  if (!match) throw unavailable();
  let receipt: Receipt;
  try {
    const valid = await crypto.subtle.verify("HMAC", await signingKey(), new Uint8Array(fromBase64Url(match[2])), encoder.encode(`${PREFIX}${match[1]}`));
    if (!valid) throw unavailable();
    receipt = JSON.parse(new TextDecoder().decode(fromBase64Url(match[1]))) as Receipt;
  } catch (error) {
    if (error instanceof MothError) throw error;
    throw unavailable();
  }
  if (
    receipt.v !== 1 || typeof receipt.asset !== "string" || !ID_RE.test(receipt.asset) ||
    !Number.isSafeInteger(receipt.bytes) || receipt.bytes < 1 || receipt.bytes > MAX_UPLOAD_BYTES ||
    !Number.isSafeInteger(receipt.submitted) || !Number.isSafeInteger(receipt.completed) || receipt.completed < receipt.submitted ||
    !Number.isSafeInteger(receipt.expires) || typeof receipt.model !== "string" || receipt.model.length > 128 ||
    receipt.scope !== await credentialScope(request)
  ) throw unavailable();
  if (Date.now() > receipt.expires) {
    throw new MothError({ status: 410, type: "openai_job_expired", message: "This image job receipt has expired. Start a new image pass.", retryable: false });
  }
  return receipt;
}

function output(receipt: Receipt): MothOutput {
  return { slot: "result", content_type: "image/png", size_bytes: receipt.bytes, output_asset_id: receipt.asset, filename: "openai-membrane.png" };
}

function providerError(error: OpenAIImageError): MothError {
  const status = error.code === "missing_key" ? 503 : error.code === "invalid_input" ? 400 : error.code === "authentication" ? 401 : error.code === "rate_limit" ? 429 : 502;
  // A generic retry could create another paid image. Explicit user retry is required.
  return new MothError({ status, type: `openai_image_${error.code}`, message: error.message, retryable: false });
}

/** Await the real edit and Moth upload before issuing a completed receipt; no detached background promises. */
export async function submitOpenAIImageJob(
  request: Request,
  imageAssetId: string | undefined,
  atlas: ImageAtlas,
  options: SubmitOptions = {},
): Promise<{ job_id: string; status: string; submitted_at: string }> {
  if (!imageAssetId || !ID_RE.test(imageAssetId)) throw new MothError({ status: 400, type: "bad_input_files", message: "input_files.image must identify an uploaded colony PNG.", retryable: false });
  if (!process.env.OPENAI_API_KEY) throw providerError(new OpenAIImageError("missing_key", "Set OPENAI_API_KEY to generate the organism membrane."));
  const scope = await credentialScope(request);
  const submitted = Date.now();
  try {
    const source = await atlas.fetchAsset(imageAssetId, request.signal);
    if (request.signal.aborted) throw abortError();
    const contentLength = Number(source.headers.get("content-length") ?? 0);
    if (contentLength > MAX_UPLOAD_BYTES) throw new MothError({ status: 413, type: "image_too_large", message: "The colony image is too large.", retryable: false });
    const seed = new Uint8Array(await source.arrayBuffer());
    if (seed.byteLength > MAX_UPLOAD_BYTES) throw new MothError({ status: 413, type: "image_too_large", message: "The colony image is too large.", retryable: false });
    const edited = await (options.edit ?? editOrganismMembrane)(seed, { signal: request.signal });
    if (request.signal.aborted) throw abortError();
    if (edited.png.byteLength > MAX_UPLOAD_BYTES) throw new MothError({ status: 413, type: "image_too_large", message: "The generated membrane is too large.", retryable: false });
    const asset = await atlas.uploadAsset(edited.png, "openai-membrane.png", "image/png", request.signal);
    const completed = Date.now();
    const job_id = await signReceipt({ v: 1, asset, bytes: edited.png.byteLength, submitted, completed, expires: completed + RECEIPT_LIFETIME_MS, scope, model: edited.model, ...(edited.requestId ? { requestId: edited.requestId } : {}) });
    return { job_id, status: "completed", submitted_at: new Date(submitted).toISOString() };
  } catch (error) {
    if (request.signal.aborted) throw abortError();
    if (error instanceof OpenAIImageError) throw providerError(error);
    if (error instanceof MothError) throw new MothError({ status: error.status, type: error.type, message: error.message, retryable: false });
    throw new MothError({ status: 502, type: "openai_image_failed", message: "The membrane image could not be generated and uploaded.", retryable: false });
  }
}

export async function openAIImageJobStatus(request: Request, jobId: string): Promise<MothJobStatus & { submitted_at: string; updated_at: string }> {
  const receipt = await readReceipt(request, jobId);
  return { job_id: jobId, engine_id: "tessa-image-v1", status: "completed", submitted_at: new Date(receipt.submitted).toISOString(), updated_at: new Date(receipt.completed).toISOString(), outputs: [output(receipt)], result: { provider: "openai", model: receipt.model } };
}

export async function openAIImageJobResult(request: Request, jobId: string): Promise<MothJobResult> {
  const receipt = await readReceipt(request, jobId);
  return { outputs: [output(receipt)], result: { provider: "openai", model: receipt.model, ...(receipt.requestId ? { request_id: receipt.requestId } : {}) } };
}
