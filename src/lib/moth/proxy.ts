/** Shared server-side Atlas client for the /api/moth/* proxy (lazy singleton; key read from env). */
import { AtlasClient, configuredMothBase } from "./atlas";
import { MothError } from "./errors";

let client: AtlasClient | null = null;
const BEARER_RE = /^Bearer\s+(.+?)\s*$/i;

/**
 * Return a request-scoped client when the browser supplied an Authorization header. The supplied
 * credential is intentionally never cached: a malformed or rejected header must not fall back to
 * the server account, and one visitor's key must never be visible to another request.
 */
export function proxyClient(request?: Request): AtlasClient {
  const authorization = request?.headers.get("authorization");
  if (authorization !== null && authorization !== undefined) {
    const match = BEARER_RE.exec(authorization);
    const apiKey = match?.[1]?.trim();
    if (!apiKey) {
      throw new MothError({ status: 400, type: "bad_authorization", message: "Authorization must contain a Bearer credential", retryable: false });
    }
    return new AtlasClient({ apiKey, base: configuredMothBase(), requestTimeoutMs: 60_000 });
  }
  if (!client) client = new AtlasClient({ requestTimeoutMs: 60_000 });
  return client;
}
