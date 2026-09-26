/**
 * Typed errors for the Moth Atlas client (server + browser). Isomorphic.
 */

export interface MothErrorInit {
  status?: number; // HTTP status (0 = network / client-side)
  type?: string; // Atlas error type / problem title, e.g. "engine_timeout", "too_many_values"
  message: string;
  retryable?: boolean;
  jobId?: string;
  engineId?: string;
}

export class MothError extends Error {
  readonly status: number;
  readonly type: string;
  readonly retryable: boolean;
  readonly jobId?: string;
  readonly engineId?: string;

  constructor(init: MothErrorInit) {
    super(init.message);
    this.name = "MothError";
    this.status = init.status ?? 0;
    this.type = init.type ?? "error";
    this.retryable = init.retryable ?? isRetryableStatus(this.status);
    this.jobId = init.jobId;
    this.engineId = init.engineId;
  }

  toJSON() {
    return { status: this.status, type: this.type, message: this.message, retryable: this.retryable };
  }
}

/** Transient HTTP statuses worth retrying (0 = network failure). */
export function isRetryableStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
}

/** Error types Atlas reports on failed jobs that are known to be transient. */
export const RETRYABLE_JOB_ERRORS = new Set(["engine_timeout", "timeout", "worker_lost", "backend_unavailable", "rate_limited"]);

export function isAbortError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    ((e as { name?: string }).name === "AbortError" || (e as { code?: string }).code === "ABORT_ERR")
  );
}

export function abortError(): Error {
  const e = new Error("Aborted");
  e.name = "AbortError";
  return e;
}

/**
 * Parse an error response body (RFC 7807 problem+json from Atlas, or our proxy's `{error:{...}}`) into a MothError.
 */
export async function errorFromResponse(res: Response, context: string): Promise<MothError> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    /* ignore */
  }
  let type = `http_${res.status}`;
  let message = text.slice(0, 500) || res.statusText || "request failed";
  let retryable: boolean | undefined;
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const inner = (j.error && typeof j.error === "object" ? j.error : j) as Record<string, unknown>;
    if (typeof inner.type === "string" && inner.type !== "about:blank") type = inner.type;
    else if (typeof inner.title === "string") type = inner.title;
    const detail = inner.detail ?? inner.message;
    if (typeof detail === "string") message = detail;
    const errs = inner.errors;
    if (Array.isArray(errs) && errs.length) {
      const parts = errs
        .map((x) => (x && typeof x === "object" ? `${(x as { location?: string }).location ?? ""} ${(x as { message?: string }).message ?? ""}`.trim() : String(x)))
        .filter(Boolean);
      if (parts.length) message = `${message}: ${parts.join("; ")}`;
    }
    if (typeof inner.retryable === "boolean") retryable = inner.retryable;
  } catch {
    /* not JSON */
  }
  return new MothError({ status: res.status, type, message: `${context}: ${message}`, retryable });
}
