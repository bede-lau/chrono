/** Focused, no-network regression for visitor-supplied Moth credentials. */
import assert from "node:assert/strict";
import { POST as checkKey } from "../src/app/api/moth/key/check/route";
import { GET as downloadRoute } from "../src/app/api/moth/assets/[assetId]/download/route";
import { GET as statusRoute } from "../src/app/api/moth/jobs/[jobId]/status/route";
import { createBrowserTransport } from "../src/lib/moth/browser";
import { MothError } from "../src/lib/moth/errors";
import { proxyClient } from "../src/lib/moth/proxy";

const savedFetch = globalThis.fetch;
const savedKey = process.env.MOTH_API_KEY;
const savedBase = process.env.MOTH_API_BASE;
const serverKey = "moth_server_only";
const visitorKey = "moth_visitor_123";
const reflectedKey = "moth_reflected_456";
const bogusIdentityKey = "moth_bogus_identity";
const jobId = "43bb9204-0426-403a-8f09-d5acc91e3ad3";
const assetId = "0d7148bb-1fa7-470a-82c2-f07c4f1d4f17";
const secondDownloadKey = "moth_download_second";
const requests: Array<{ url: string; method: string; authorization: string | null }> = [];

process.env.MOTH_API_KEY = serverKey;
process.env.MOTH_API_BASE = "https://atlas.test/api/v1";
globalThis.fetch = async (input, init) => {
  const url = String(input);
  const headers = new Headers(init?.headers);
  const authorization = headers.get("authorization");
  requests.push({ url, method: init?.method ?? "GET", authorization });

  if (url.endsWith("/me")) {
    if (authorization === `Bearer ${visitorKey}`) {
      return Response.json({ id: "authenticated-user", platform_role: "player", features: ["engines"] });
    }
    if (authorization === `Bearer ${bogusIdentityKey}`) return Response.json({ ok: true });
    return Response.json({ detail: "invalid credential" }, { status: 401 });
  }
  if (url.endsWith(`/jobs/${jobId}/status`)) {
    if (authorization === `Bearer ${reflectedKey}`) {
      return Response.json({ detail: `rejected credential ${reflectedKey}` }, { status: 403 });
    }
    return Response.json({ job_id: jobId, engine_id: "comet-qrng-v1", status: "queued" });
  }
  if (url.endsWith("/assets")) return Response.json({ asset_id: "asset-123" });
  if (url.endsWith("/engines/comet-qrng-v1/process")) return Response.json({ job_id: jobId });
  if (url.endsWith(`/jobs/${jobId}/result`)) return Response.json({ outputs: [] });
  if (url === `https://atlas.test/api/v1/assets/${assetId}/download`) return Response.json({ download_url: "https://storage.test/credential-scoped-asset" });
  if (url === "https://storage.test/credential-scoped-asset") return new Response(new Uint8Array([4, 5, 6]), { headers: { "content-type": "image/png" } });
  if (url.endsWith("/assets/asset-123/download")) return new Response(new Uint8Array([1, 2, 3]));
  throw new Error(`unexpected URL ${url}`);
};

try {
  // `/me` accepts only the submitted key and returns no identity data to the browser.
  const accepted = await checkKey(new Request("http://localhost/api/moth/key/check", { method: "POST", headers: { Authorization: `Bearer ${visitorKey}` } }));
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { accepted: true });
  assert.deepEqual(requests.at(-1), { url: "https://atlas.test/api/v1/me", method: "GET", authorization: `Bearer ${visitorKey}` });

  // An upstream error body (including a hypothetical reflected secret) is never sent back to the browser.
  const rejected = await checkKey(new Request("http://localhost/api/moth/key/check", { method: "POST", headers: { Authorization: "Bearer moth_rejected" } }));
  assert.equal(rejected.status, 401);
  const rejectedBody = JSON.stringify(await rejected.json());
  assert.match(rejectedBody, /Moth did not accept this API key/);
  assert.ok(!rejectedBody.includes("moth_rejected"));
  assert.ok(!rejectedBody.includes(serverKey));

  const bogusIdentity = await checkKey(new Request("http://localhost/api/moth/key/check", { method: "POST", headers: { Authorization: `Bearer ${bogusIdentityKey}` } }));
  assert.equal(bogusIdentity.status, 503, "a 200 response without Moth's identity shape is not accepted");
  assert.deepEqual(await bogusIdentity.json(), { error: { status: 503, type: "key_check_unavailable", message: "Moth could not verify the key right now. Try again shortly.", retryable: true } });

  const malformed = await checkKey(new Request("http://localhost/api/moth/key/check", { method: "POST", headers: { Authorization: "Bearer moth_ contains-space" } }));
  assert.equal(malformed.status, 400, "malformed/empty supplied keys are rejected before Atlas");

  // Any Authorization header selects an isolated client. A bad header never silently uses MOTH_API_KEY.
  assert.throws(
    () => proxyClient(new Request(`http://localhost/api/moth/jobs/${jobId}/status`, { headers: { Authorization: "Basic something" } })),
    (error: unknown) => error instanceof MothError && error.type === "bad_authorization",
  );
  const routeResponse = await statusRoute(
    new Request(`http://localhost/api/moth/jobs/${jobId}/status`, { headers: { Authorization: `Bearer ${visitorKey}` } }),
    { params: Promise.resolve({ jobId }) },
  );
  assert.equal(routeResponse.status, 200);
  assert.equal(requests.at(-1)?.authorization, `Bearer ${visitorKey}`, "route forwards the visitor credential instead of the configured server key");

  const reflected = await statusRoute(
    new Request(`http://localhost/api/moth/jobs/${jobId}/status`, { headers: { Authorization: `Bearer ${reflectedKey}` } }),
    { params: Promise.resolve({ jobId }) },
  );
  assert.equal(reflected.status, 403);
  assert.ok(!JSON.stringify(await reflected.json()).includes(reflectedKey), "a reflected upstream key is redacted before it can reach the browser");

  // Downloads cannot be cached across visitor credentials: each request reaches Atlas and says no-store.
  const firstDownload = await downloadRoute(
    new Request(`http://localhost/api/moth/assets/${assetId}/download`, { headers: { Authorization: `Bearer ${visitorKey}` } }),
    { params: Promise.resolve({ assetId }) },
  );
  const secondDownload = await downloadRoute(
    new Request(`http://localhost/api/moth/assets/${assetId}/download`, { headers: { Authorization: `Bearer ${secondDownloadKey}` } }),
    { params: Promise.resolve({ assetId }) },
  );
  assert.equal(firstDownload.headers.get("cache-control"), "no-store");
  assert.equal(firstDownload.headers.get("vary"), "Authorization");
  assert.deepEqual(new Uint8Array(await firstDownload.arrayBuffer()), new Uint8Array([4, 5, 6]));
  assert.deepEqual(new Uint8Array(await secondDownload.arrayBuffer()), new Uint8Array([4, 5, 6]));
  const downloadAuthorizations = requests
    .filter((request) => request.url === `https://atlas.test/api/v1/assets/${assetId}/download`)
    .map((request) => request.authorization);
  assert.deepEqual(downloadAuthorizations, [`Bearer ${visitorKey}`, `Bearer ${secondDownloadKey}`], "each visitor key authorizes its own download lookup");

  // The browser transport attaches the accepted key to upload, submit, polling, result, and download.
  const transport = createBrowserTransport("https://chrono.test/api/moth", { apiKey: visitorKey });
  await transport.uploadAsset(new Uint8Array([1]), "seed.png", "image/png");
  await transport.submit("comet-qrng-v1", {});
  await transport.status(jobId);
  await transport.result(jobId);
  assert.deepEqual(await transport.download({ slot: "result", output_asset_id: "asset-123", content_type: "image/png", filename: "result.png", size_bytes: 3 }), new Uint8Array([1, 2, 3]));
  const browserCalls = requests.filter((request) => request.url.startsWith("https://chrono.test/api/moth"));
  assert.equal(browserCalls.length, 5);
  assert.ok(browserCalls.every((request) => request.authorization === `Bearer ${visitorKey}`));

  await createBrowserTransport("https://chrono.test/api/moth").status(jobId);
  assert.equal(requests.at(-1)?.authorization, null, "the default browser transport sends no Authorization header");

  console.log("PASS moth key: read-only /me verification, safe errors, request-scoped proxy isolation, and browser forwarding");
} finally {
  globalThis.fetch = savedFetch;
  if (savedKey === undefined) delete process.env.MOTH_API_KEY;
  else process.env.MOTH_API_KEY = savedKey;
  if (savedBase === undefined) delete process.env.MOTH_API_BASE;
  else process.env.MOTH_API_BASE = savedBase;
}
