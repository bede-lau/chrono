/**
 * POST /api/moth/key/check — read-only Moth API-key check.
 *
 * The key arrives only in Authorization, is used for this one `/me` request, and is neither stored
 * nor included in a response, log, cache key, or cookie.
 */
import { AtlasClient, configuredMothBase } from "@/lib/moth/atlas";
import { MothError } from "@/lib/moth/errors";
import { jsonError, noStoreJson } from "@/lib/moth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY_RE = /^moth_[^\s]+$/;

export async function POST(request: Request) {
  const apiKey = bearerApiKey(request.headers.get("authorization"));
  if (!apiKey) return jsonError(400, "bad_api_key", "Enter a Moth API key starting with moth_", false);

  try {
    // This intentionally does not call proxyClient(): key verification must never fall back to
    // MOTH_API_KEY when a visitor's header is empty, malformed, or rejected.
    const atlas = new AtlasClient({ apiKey, base: configuredMothBase(), requestTimeoutMs: 10_000 });
    await atlas.verifyCredentials(request.signal);
    return noStoreJson({ accepted: true });
  } catch (error) {
    return keyCheckError(error);
  }
}

function bearerApiKey(authorization: string | null): string | null {
  const match = authorization?.match(/^Bearer\s+(.+?)\s*$/i);
  const apiKey = match?.[1]?.trim();
  // Moth documents `moth_` keys. Do not guess at a fixed length or alphabet: key formats can evolve.
  return apiKey && apiKey.length <= 4096 && KEY_RE.test(apiKey) ? apiKey : null;
}

/** Deliberately generic errors: upstream diagnostics must never reflect a submitted secret. */
function keyCheckError(error: unknown): Response {
  if (error instanceof MothError) {
    if (error.status === 401 || error.status === 403) {
      return jsonError(401, "invalid_api_key", "Moth did not accept this API key", false);
    }
    if (error.status === 429) {
      return jsonError(429, "key_check_rate_limited", "Moth is rate-limiting key checks. Try again shortly.", true);
    }
    if (error.status === 0 || error.status >= 500) {
      return jsonError(503, "key_check_unavailable", "Moth could not verify the key right now. Try again shortly.", true);
    }
  }
  return jsonError(503, "key_check_unavailable", "Moth could not verify the key right now. Try again shortly.", true);
}
