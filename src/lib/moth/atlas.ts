/**
 * Low-level Moth Atlas REST client. SERVER-ONLY in practice (needs MOTH_API_KEY): used by the Node transport
 * (scripts) and by the /api/moth/* proxy route handlers. Never import this from client components.
 */
import { MothError, errorFromResponse, abortError } from "./errors";
import type { MothJobResult, MothJobStatus } from "./transport";

export const DEFAULT_MOTH_BASE = "https://api.mothquantum.com/api/v1";

export interface AtlasClientOptions {
  apiKey?: string;
  base?: string;
  fetch?: typeof fetch;
  /** Per-request timeout for control-plane calls (ms). */
  requestTimeoutMs?: number;
}

export interface PresignedUpload {
  url: string;
  method?: string;
  headers?: Record<string, string>;
}

export interface CreatedAsset {
  asset_id: string;
  upload?: PresignedUpload;
  status?: string;
}

export interface SubmitBody {
  input_files?: Record<string, string>;
  params?: Record<string, unknown>;
}

export interface SubmittedJob {
  job_id: string;
  status: string;
  submitted_at?: string;
}

/** The only identity fields needed to prove `/me` is a real authenticated Atlas response. */
interface MothIdentity {
  id: string;
  platform_role: string;
  features: string[];
}

export function configuredMothBase(): string {
  return (process.env.MOTH_API_BASE || DEFAULT_MOTH_BASE).replace(/\/+$/, "");
}

export function readServerEnv(): { apiKey: string; base: string } {
  const apiKey = process.env.MOTH_API_KEY;
  const base = configuredMothBase();
  if (!apiKey) {
    throw new MothError({ status: 500, type: "missing_api_key", message: "MOTH_API_KEY is not set on the server", retryable: false });
  }
  return { apiKey, base };
}

export class AtlasClient {
  private readonly apiKey: string;
  private readonly base: string;
  private readonly f: typeof fetch;
  private readonly requestTimeoutMs: number;

  constructor(opts: AtlasClientOptions = {}) {
    const env = opts.apiKey ? { apiKey: opts.apiKey, base: opts.base ?? DEFAULT_MOTH_BASE } : readServerEnv();
    this.apiKey = env.apiKey;
    this.base = (opts.base ?? env.base).replace(/\/+$/, "");
    this.f = opts.fetch ?? fetch;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 60_000;
  }

  /** Upstream problem details are untrusted and must never reflect a visitor's bearer credential. */
  private redactApiKey(value: string): string {
    return value.split(this.apiKey).join("[redacted]");
  }

  private async call(path: string, init: Omit<RequestInit, "signal"> & { signal?: AbortSignal } = {}, context = path): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.requestTimeoutMs);
    const onAbort = () => ctrl.abort();
    init.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await this.f(`${this.base}${path}`, {
        ...init,
        signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
          ...(init.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}),
          ...(init.headers as Record<string, string> | undefined),
        },
        cache: "no-store",
      });
      if (!res.ok) throw await errorFromResponse(res, context);
      return res;
    } catch (e) {
      if (e instanceof MothError) {
        throw new MothError({
          status: e.status,
          type: this.redactApiKey(e.type),
          message: this.redactApiKey(e.message),
          retryable: e.retryable,
          jobId: e.jobId,
          engineId: e.engineId,
        });
      }
      if (init.signal?.aborted) throw abortError();
      const timedOut = ctrl.signal.aborted;
      throw new MothError({
        status: 0,
        type: timedOut ? "request_timeout" : "network_error",
        message: this.redactApiKey(`${context}: ${timedOut ? `no response in ${this.requestTimeoutMs} ms` : (e as Error)?.message ?? String(e)}`),
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", onAbort);
    }
  }

  private async json<T>(path: string, init: Omit<RequestInit, "signal"> & { signal?: AbortSignal } = {}, context = path): Promise<T> {
    const res = await this.call(path, init, context);
    return (await res.json()) as T;
  }

  /** create -> PUT presigned -> complete. Returns asset_id. */
  async uploadAsset(bytes: Uint8Array, filename: string, contentType: string, signal?: AbortSignal): Promise<string> {
    const created = await this.json<CreatedAsset>(
      "/assets",
      { method: "POST", body: JSON.stringify({ filename, content_type: contentType, size_bytes: bytes.byteLength }), signal },
      `create asset ${filename}`,
    );
    if (!created.asset_id || !created.upload?.url) {
      throw new MothError({ status: 502, type: "bad_upstream", message: `create asset ${filename}: no upload url`, retryable: true });
    }
    const up = created.upload;
    let putRes: Response;
    try {
      putRes = await this.f(up.url, {
        method: up.method || "PUT",
        headers: up.headers ?? { "Content-Type": contentType },
        body: bytes as unknown as BodyInit,
        signal,
      });
    } catch (e) {
      if (signal?.aborted) throw abortError();
      throw new MothError({ status: 0, type: "network_error", message: this.redactApiKey(`upload ${filename}: ${(e as Error).message}`), retryable: true });
    }
    if (!putRes.ok) {
      const text = await putRes.text().catch(() => "");
      throw new MothError({ status: putRes.status, type: "upload_failed", message: this.redactApiKey(`upload ${filename}: ${putRes.status} ${text.slice(0, 200)}`) });
    }
    await this.call(`/assets/${encodeURIComponent(created.asset_id)}/complete`, { method: "POST", signal }, `complete asset ${filename}`);
    return created.asset_id;
  }

  submit(engineId: string, body: SubmitBody, signal?: AbortSignal): Promise<SubmittedJob> {
    return this.json<SubmittedJob>(
      `/engines/${encodeURIComponent(engineId)}/process`,
      { method: "POST", body: JSON.stringify(body), signal },
      `submit ${engineId}`,
    );
  }

  status(jobId: string, signal?: AbortSignal): Promise<MothJobStatus> {
    return this.json<MothJobStatus>(`/jobs/${encodeURIComponent(jobId)}/status`, { signal }, `status ${jobId}`);
  }

  result(jobId: string, signal?: AbortSignal): Promise<MothJobResult> {
    return this.json<MothJobResult>(`/jobs/${encodeURIComponent(jobId)}/result`, { signal }, `result ${jobId}`);
  }

  /**
   * Read-only credential check. We deliberately discard the returned identity so a browser can learn
   * only whether its key works, not account information.
   */
  async verifyCredentials(signal?: AbortSignal): Promise<void> {
    const identity = await this.json<unknown>("/me", { signal }, "verify Moth API key");
    if (!isMothIdentity(identity)) {
      throw new MothError({ status: 502, type: "bad_upstream", message: "Moth returned an invalid identity response", retryable: true });
    }
  }

  /** Presigned GET url for an asset (input or output). */
  async downloadUrl(assetId: string, signal?: AbortSignal): Promise<string> {
    const j = await this.json<{ download_url: string }>(
      `/assets/${encodeURIComponent(assetId)}/download`,
      { signal },
      `download ${assetId}`,
    );
    if (!j.download_url) throw new MothError({ status: 502, type: "bad_upstream", message: `download ${assetId}: no download_url` });
    return j.download_url;
  }

  /** Fetch an asset's bytes as a streaming Response (server-side; no arbitrary URLs — only Atlas-issued presigned ones). */
  async fetchAsset(assetId: string, signal?: AbortSignal): Promise<Response> {
    const url = await this.downloadUrl(assetId, signal);
    let res: Response;
    try {
      res = await this.f(url, { signal, cache: "no-store" });
    } catch (e) {
      if (signal?.aborted) throw abortError();
      throw new MothError({ status: 0, type: "network_error", message: this.redactApiKey(`fetch asset ${assetId}: ${(e as Error).message}`), retryable: true });
    }
    if (!res.ok) {
      throw new MothError({ status: res.status, type: "download_failed", message: `fetch asset ${assetId}: ${res.status}` });
    }
    return res;
  }
}

function isMothIdentity(value: unknown): value is MothIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const identity = value as Record<string, unknown>;
  return (
    typeof identity.id === "string" && identity.id.length > 0 &&
    typeof identity.platform_role === "string" && identity.platform_role.length > 0 &&
    Array.isArray(identity.features) && identity.features.every((feature) => typeof feature === "string")
  );
}
