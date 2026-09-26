/**
 * Node transport: talks to api.mothquantum.com directly with MOTH_API_KEY (scripts + route handlers).
 * Do not import from client components — it reads the secret from process.env.
 */
import { AtlasClient, type AtlasClientOptions } from "./atlas";
import { MothError } from "./errors";
import type { MothJobResult, MothJobStatus, MothOutput, MothTransport } from "./transport";

export function createServerTransport(opts: AtlasClientOptions = {}): MothTransport {
  const atlas = new AtlasClient(opts);
  const f = opts.fetch ?? fetch;

  async function fetchBytes(url: string, what: string): Promise<Uint8Array> {
    let res: Response;
    try {
      res = await f(url, { cache: "no-store" });
    } catch (e) {
      throw new MothError({ status: 0, type: "network_error", message: `download ${what}: ${(e as Error).message}`, retryable: true });
    }
    if (!res.ok) throw new MothError({ status: res.status, type: "download_failed", message: `download ${what}: HTTP ${res.status}` });
    return new Uint8Array(await res.arrayBuffer());
  }

  return {
    uploadAsset: (bytes, filename, contentType) => atlas.uploadAsset(bytes, filename, contentType),
    submit: async (engineId, body) => (await atlas.submit(engineId, body)).job_id,
    status: (jobId): Promise<MothJobStatus> => atlas.status(jobId),
    result: (jobId): Promise<MothJobResult> => atlas.result(jobId),
    async download(output: MothOutput): Promise<Uint8Array> {
      // Presigned result URLs expire after 15 min; fall back to a fresh one via /assets/{id}/download.
      if (output.url) {
        try {
          return await fetchBytes(output.url, output.filename || output.output_asset_id);
        } catch (e) {
          if (!output.output_asset_id) throw e;
        }
      }
      if (!output.output_asset_id) throw new MothError({ status: 400, type: "no_asset", message: "output has neither url nor output_asset_id" });
      const url = await atlas.downloadUrl(output.output_asset_id);
      return fetchBytes(url, output.output_asset_id);
    },
  };
}
