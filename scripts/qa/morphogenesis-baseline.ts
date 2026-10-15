/**
 * Compare Tessa with the last commit verified by a full live Create.
 * Offline by default. --live makes exactly one historical and one current-proxy submission.
 * Run: node --env-file=.env.local --import tsx scripts/qa/morphogenesis-baseline.ts --live
 * The running browser specimen and repository files are never replaced.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createBrowserTransport } from "../../src/lib/moth/browser";
import { runJob as currentRunJob } from "../../src/lib/moth/job";
import type { MothJobStatus, MothTransport } from "../../src/lib/moth/transport";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const revision = "4b123ed";
const specimenId = "6a5efd";
const gitFile = (name: string) => execFileSync("git", ["show", `${revision}:${name}`], { cwd: root });
const commit = execFileSync("git", ["rev-parse", revision], { cwd: root, encoding: "utf8" }).trim();
const manifest = JSON.parse(gitFile(`public/specimens/${specimenId}/manifest.json`).toString());
const seed = gitFile(`public/specimens/${specimenId}/seed.png`);
const params = manifest.runs.morphogenesis.params as Record<string, unknown>;
assert.deepEqual(params, { machine: "aer", shots: 1024 });
assert.equal(seed.readUInt32BE(16), 32);
assert.equal(seed.readUInt32BE(20), 32);
assert.match(gitFile("src/lib/chain/pipeline.ts").toString(), /const params = \{ machine, shots: 1024 \}/);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const baseline = {
  commit, specimenId, seedSha256: sha256(seed), seedBytes: seed.length,
  dimensions: [32, 32], params, priorJobId: manifest.runs.morphogenesis.jobId,
  priorLatencyMs: manifest.runs.morphogenesis.latencyMs,
};
console.log(JSON.stringify({ baseline }, null, 2));
if (!process.argv.includes("--live")) {
  console.log("Offline comparison only; pass --live to submit the two bounded tests.");
  process.exit(0);
}

const scratch = await mkdtemp(path.join(tmpdir(), "chrono-morph-baseline-"));
await writeFile(path.join(scratch, "package.json"), JSON.stringify({ type: "module" }));
for (const name of ["server.ts", "atlas.ts", "job.ts", "errors.ts", "transport.ts"]) {
  await writeFile(path.join(scratch, name), gitFile(`src/lib/moth/${name}`));
}
const historical = await import(pathToFileURL(path.join(scratch, "server.ts")).href);
const historicalJob = await import(pathToFileURL(path.join(scratch, "job.ts")).href);
const originalTimeout = historicalJob.defaultTimeoutMs("tessa-image-v1") as number;
assert.equal(originalTimeout, 40 * 60_000);
const report: Record<string, unknown> = { baseline, originalTimeoutMs: originalTimeout, runs: [] };
const runs = report.runs as Record<string, unknown>[];
const reportPath = path.join(scratch, "report.json");
const redact = (message: string) => process.env.MOTH_API_KEY ? message.split(process.env.MOTH_API_KEY).join("[redacted]") : message;

async function test(label: string, transport: MothTransport, runJob: typeof currentRunJob) {
  const startedAt = new Date().toISOString();
  let jobId: string | undefined;
  let latest: (MothJobStatus & { submitted_at?: string; updated_at?: string }) | undefined;
  let submissions = 0;
  const asset = await transport.uploadAsset(seed, `${specimenId}-original-seed.png`, "image/png");
  const downloaded = await transport.download({ output_asset_id: asset, filename: "seed.png", slot: "image", content_type: "image/png", size_bytes: seed.length });
  assert.equal(sha256(downloaded), baseline.seedSha256, "uploaded seed must match the historical bytes exactly");
  const observed: MothTransport = {
    ...transport,
    submit: async (engine, body) => {
      assert.equal(++submissions, 1, "one submission per test; no automatic retry loop");
      assert.deepEqual(body, { input_files: { image: asset }, params });
      jobId = await transport.submit(engine, body);
      console.log(JSON.stringify({ label, jobId, phase: "submitted" }));
      return jobId;
    },
    status: async (id) => {
      latest = await transport.status(id);
      return latest;
    },
  };
  const t0 = Date.now();
  let outcome: Record<string, unknown>;
  try {
    const out = await runJob(observed, "tessa-image-v1", { input_files: { image: asset }, params }, {
      maxAttempts: 1,
      // Preserve the old client window in both tests, so the recent 90-second budget cannot confound them.
      timeoutMs: originalTimeout,
    });
    const output = out.result.outputs?.find((o) => o.content_type.startsWith("image/"));
    assert.ok(output, "successful Tessa must produce a real skin image");
    const pixels = await transport.download(output);
    await writeFile(path.join(scratch, `${label}-skin.png`), pixels);
    outcome = { status: "completed", outputAsset: output.output_asset_id, outputSha256: sha256(pixels) };
  } catch (error) {
    const e = error as { type?: string; message?: string };
    outcome = { status: latest?.status ?? "request_error", errorType: e.type, message: redact(e.message ?? String(error)) };
  }
  const row = { label, startedAt, jobId, asset, submissions, params, elapsedMs: Date.now() - t0, remoteSubmittedAt: latest?.submitted_at, remoteUpdatedAt: latest?.updated_at, ...outcome };
  runs.push(row);
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(row));
}

console.log(JSON.stringify({ reportPath, note: "Original engine params and polling window; one attempt per path to avoid six duplicate submissions." }));
await test("historical-client", historical.createServerTransport(), historicalJob.runJob);
await test("current-local-proxy", createBrowserTransport("http://localhost:3002/api/moth"), currentRunJob);
console.log(JSON.stringify({ reportPath, complete: true }));
