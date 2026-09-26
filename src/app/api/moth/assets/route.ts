/**
 * POST /api/moth/assets — raw body + `x-filename` + Content-Type -> Atlas create/PUT/complete -> { asset_id }.
 */
import { MAX_UPLOAD_BYTES, UPLOAD_CONTENT_TYPES } from "@/lib/moth/engines";
import { errorResponse, jsonError, noStoreJson } from "@/lib/moth/http";
import { proxyClient } from "@/lib/moth/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const contentType = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!UPLOAD_CONTENT_TYPES.has(contentType)) {
    return jsonError(415, "unsupported_media_type", `content-type must be one of ${[...UPLOAD_CONTENT_TYPES].join(", ")}`, false);
  }
  let filename = request.headers.get("x-filename") || "";
  try {
    filename = decodeURIComponent(filename);
  } catch {
    /* keep raw */
  }
  filename = filename.replace(/[^\w.\-]+/g, "_").slice(0, 120);
  if (!filename) return jsonError(400, "missing_filename", "x-filename header is required", false);

  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_UPLOAD_BYTES) return jsonError(413, "too_large", `max ${MAX_UPLOAD_BYTES} bytes`, false);

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await request.arrayBuffer());
  } catch {
    return jsonError(400, "bad_body", "could not read request body", false);
  }
  if (bytes.byteLength === 0) return jsonError(400, "empty_body", "request body is empty", false);
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return jsonError(413, "too_large", `max ${MAX_UPLOAD_BYTES} bytes`, false);

  try {
    const asset_id = await proxyClient().uploadAsset(bytes, filename, contentType, request.signal);
    return noStoreJson({ asset_id, filename, content_type: contentType, size_bytes: bytes.byteLength });
  } catch (e) {
    return errorResponse(e);
  }
}
