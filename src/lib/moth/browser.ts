/**
 * Browser transport: every call goes through our Next.js proxy (/api/moth/*) — Atlas CORS only allows
 * http://localhost:3000 and the API key must stay server-side.
 */
import { MothError, errorFromResponse, abortError } from "./errors";
import type { MothJobResult, MothJobStatus, MothOutput, MothTransport } from "./transport";

export function createBrowserTransport(base = "/api/moth", opts: { signal?: AbortSignal } = {}): MothTransport {
  const root = base.replace(/\/+$/, "");

  async function call(path: string, init: RequestInit, context: string): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${root}${path}`, { ...init, cache: "no-store", signal: opts.signal });
    } catch (e) {
      if (opts.signal?.aborted) throw abortError();
      throw new MothError({ status: 0, type: "network_error", message: `${context}: ${(e as Error).message}`, retryable: true });
    }
    if (!res.ok) throw await errorFromResponse(res, context);
    return res;
  }

  return {
    async uploadAsset(bytes: Uint8Array, filename: string, contentType: string): Promise<string> {
      const res = await call(
        "/assets",
        {
          method: "POST",
          headers: { "Content-Type": contentType, "x-filename": encodeURIComponent(filename) },
          body: bytes as unknown as BodyInit,
        },
        `upload ${filename}`,
      );
      const j = (await res.json()) as { asset_id?: string };
      if (!j.asset_id) throw new MothError({ status: 502, type: "bad_upstream", message: `upload ${filename}: no asset_id` });
      return j.asset_id;
    },
    async submit(engineId, body): Promise<string> {
      const res = await call(
        `/engines/${encodeURIComponent(engineId)}/process`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
        `submit ${engineId}`,
      );
      const j = (await res.json()) as { job_id?: string };
      if (!j.job_id) throw new MothError({ status: 502, type: "bad_upstream", message: `submit ${engineId}: no job_id` });
      return j.job_id;
    },
    async status(jobId: string): Promise<MothJobStatus> {
      return (await (await call(`/jobs/${encodeURIComponent(jobId)}/status`, {}, `status ${jobId}`)).json()) as MothJobStatus;
    },
    async result(jobId: string): Promise<MothJobResult> {
      return (await (await call(`/jobs/${encodeURIComponent(jobId)}/result`, {}, `result ${jobId}`)).json()) as MothJobResult;
    },
    async download(output: MothOutput): Promise<Uint8Array> {
      const id = output.output_asset_id;
      if (!id) throw new MothError({ status: 400, type: "no_asset", message: "output has no output_asset_id" });
      const res = await call(`/assets/${encodeURIComponent(id)}/download`, {}, `download ${output.filename || id}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
