/**
 * POST /api/moth/engines/:engineId/process — whitelisted engines only. Body: { input_files?, params? }.
 */
import { ID_RE, PROXY_ENGINE_WHITELIST } from "@/lib/moth/engines";
import { errorResponse, jsonError, noStoreJson } from "@/lib/moth/http";
import { proxyClient } from "@/lib/moth/proxy";
import { submitOpenAIImageJob } from "@/lib/openai/membraneJob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

export async function POST(request: Request, { params }: { params: Promise<{ engineId: string }> }) {
  const { engineId } = await params;
  if (!PROXY_ENGINE_WHITELIST.has(engineId)) {
    return jsonError(403, "engine_not_allowed", `engine '${engineId}' is not available through this proxy`, false);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "bad_json", "body must be JSON { input_files?, params? }", false);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError(400, "bad_body", "body must be an object { input_files?, params? }", false);
  }
  const { input_files, params: engineParams } = body as { input_files?: unknown; params?: unknown };
  if (input_files !== undefined) {
    if (!input_files || typeof input_files !== "object" || Array.isArray(input_files)) {
      return jsonError(400, "bad_input_files", "input_files must be an object of slot -> asset_id", false);
    }
    for (const [slot, id] of Object.entries(input_files as Record<string, unknown>)) {
      if (typeof id !== "string" || !ID_RE.test(id)) return jsonError(400, "bad_input_files", `input_files.${slot} must be an asset id`, false);
    }
  }
  if (engineParams !== undefined && (typeof engineParams !== "object" || engineParams === null || Array.isArray(engineParams))) {
    return jsonError(400, "bad_params", "params must be an object", false);
  }
  try {
    if (engineId === "tessa-image-v1") {
      const image = (input_files as Record<string, string> | undefined)?.image;
      const job = await submitOpenAIImageJob(request, image, proxyClient(request));
      const response = noStoreJson(job, 202);
      response.headers.set("Vary", "Authorization");
      return response;
    }
    const job = await proxyClient(request).submit(engineId, {
      ...(input_files ? { input_files: input_files as Record<string, string> } : {}),
      ...(engineParams ? { params: engineParams as Record<string, unknown> } : {}),
    }, request.signal);
    return noStoreJson({ job_id: job.job_id, status: job.status, submitted_at: job.submitted_at }, 202);
  } catch (e) {
    return errorResponse(e);
  }
}
