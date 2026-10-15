/** GET /api/moth/jobs/:jobId/result — outputs keep their metadata; bytes are fetched via /api/moth/assets/:id/download. */
import { ID_RE } from "@/lib/moth/engines";
import { errorResponse, jsonError, noStoreJson } from "@/lib/moth/http";
import { proxyClient } from "@/lib/moth/proxy";
import { isOpenAIImageJob, openAIImageJobResult } from "@/lib/openai/membraneJob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!isOpenAIImageJob(jobId) && !ID_RE.test(jobId)) return jsonError(400, "bad_job_id", "invalid job id", false);
  try {
    const r = isOpenAIImageJob(jobId) ? await openAIImageJobResult(request, jobId) : await proxyClient(request).result(jobId, request.signal);
    const response = noStoreJson({
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
    response.headers.set("Vary", "Authorization");
    return response;
  } catch (e) {
    return errorResponse(e);
  }
}
