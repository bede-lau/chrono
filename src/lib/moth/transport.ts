/**
 * Moth Atlas transport contract. OWNER: pipeline agent (implements server + browser variants).
 * Browser code MUST go through the Next.js proxy (/api/moth/*) — Atlas CORS only allows http://localhost:3000.
 */
export interface MothJobStatus {
  job_id: string;
  engine_id: string;
  status: "queued" | "processing" | "completed" | "failed" | string;
  error?: { type?: string; message?: string; retryable?: boolean };
  result?: unknown;
  outputs?: MothOutput[] | null;
}
export interface MothOutput {
  slot: string;
  content_type: string;
  size_bytes: number;
  output_asset_id: string;
  filename: string;
  url?: string; // presigned GET (only on /result)
}
export interface MothJobResult {
  outputs?: MothOutput[] | null;
  result?: unknown;
}
export interface MothTransport {
  uploadAsset(bytes: Uint8Array, filename: string, contentType: string): Promise<string>; // -> asset_id
  submit(engineId: string, body: { input_files?: Record<string, string>; params?: Record<string, unknown> }): Promise<string>; // -> job_id
  status(jobId: string): Promise<MothJobStatus>;
  result(jobId: string): Promise<MothJobResult>;
  /** Fetch bytes of an output (by presigned url, or asset id). Browser impl proxies through /api/moth/download. */
  download(output: MothOutput): Promise<Uint8Array>;
}
