/** Shared server-side Atlas client for the /api/moth/* proxy (lazy singleton; key read from env). */
import { AtlasClient } from "./atlas";

let client: AtlasClient | null = null;
export function proxyClient(): AtlasClient {
  if (!client) client = new AtlasClient({ requestTimeoutMs: 60_000 });
  return client;
}
