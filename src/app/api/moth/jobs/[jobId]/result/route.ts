/** GET /api/moth/jobs/:jobId/result — outputs keep their metadata; bytes are fetched via /api/moth/assets/:id/download. */
import { ID_RE } from "@/lib/moth/engines";
import { errorResponse, jsonError, noStoreJson } from "@/lib/moth/http";
import { proxyClient } from "@/lib/moth/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!ID_RE.test(jobId)) return jsonError(400, "bad_job_id", "invalid job id", false);
  try {
    const r = await proxyClient().result(jobId);
    return noStoreJson({
      outputs: (r.outputs ?? null)?.map((o) => ({
        slot: o.slot,
        content_type: o.content_type,
        size_bytes: o.size_bytes,
        output_asset_id: o.output_asset_id,
        filename: o.filename,
        url: `/api/moth/assets/${o.output_asset_id}/download`,
      })) ?? null,
      result: r.result ?? null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
