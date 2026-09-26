/**
 * GET /api/moth/assets/:assetId/download — streams the asset bytes server-side
 * (Atlas /assets/{id}/download -> presigned URL -> fetch). No arbitrary-URL fetching.
 */
import { ID_RE } from "@/lib/moth/engines";
import { errorResponse, jsonError } from "@/lib/moth/http";
import { proxyClient } from "@/lib/moth/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  if (!ID_RE.test(assetId)) return jsonError(400, "bad_asset_id", "invalid asset id", false);
  try {
    const upstream = await proxyClient().fetchAsset(assetId, request.signal);
    const headers = new Headers({ "Cache-Control": "private, max-age=3600" });
    for (const h of ["content-type", "content-length", "content-disposition"]) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    return new Response(upstream.body, { status: 200, headers });
  } catch (e) {
    return errorResponse(e);
  }
}
