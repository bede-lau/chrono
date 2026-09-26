/** Helpers for the /api/moth/* route handlers (server-only). */
import { MothError, isRetryableStatus } from "./errors";

export function jsonError(status: number, type: string, message: string, retryable = isRetryableStatus(status)): Response {
  return Response.json({ error: { status, type, message, retryable } }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Map any thrown error to a clean JSON error response (never leaks the API key or stack). */
export function errorResponse(e: unknown): Response {
  if (e instanceof MothError) {
    // Upstream network failures surface as 502; upstream HTTP statuses pass through (4xx client, 5xx -> 502).
    const status = e.status === 0 ? 502 : e.status >= 500 ? 502 : e.status === 200 ? 502 : e.status;
    return jsonError(status, e.type, e.message, e.retryable);
  }
  const msg = e instanceof Error ? e.message : String(e);
  return jsonError(500, "internal_error", msg.slice(0, 300), false);
}

export function noStoreJson(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
