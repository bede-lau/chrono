/** GET /api/moth/jobs/:jobId/status */
import { ID_RE } from "@/lib/moth/engines";
import { errorResponse, jsonError, noStoreJson } from "@/lib/moth/http";
import { proxyClient } from "@/lib/moth/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!ID_RE.test(jobId)) return jsonError(400, "bad_job_id", "invalid job id", false);
  try {
    const st = await proxyClient().status(jobId);
    const { job_id, engine_id, status, error, outputs, result } = st as typeof st & Record<string, unknown>;
    const extra = st as unknown as Record<string, unknown>;
    return noStoreJson({
      job_id,
      engine_id,
      status,
      ...(error ? { error } : {}),
      ...(outputs ? { outputs } : {}),
      ...(result !== undefined ? { result } : {}),
      ...(extra.progress !== undefined ? { progress: extra.progress } : {}),
      ...(extra.submitted_at ? { submitted_at: extra.submitted_at, updated_at: extra.updated_at } : {}),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
