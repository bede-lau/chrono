/**
 * Bounded Tessa workload sweep; offline by default, no browser/store/config mutation.
 * node --env-file=.env.local --import tsx scripts/qa/tessa-variants.ts --live
 * Six distinct variants, one submission each. A fast usable candidate gets two
 * fresh-specimen confirmation runs, with an overall cap of eight submissions.
 * --only LABEL runs one case without confirmations. --direct bypasses the local proxy.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng, renderColonySeed, type RGBAImage } from "../../src/lib/imaging";
import type { Specimen } from "../../src/lib/chain/types";
import { createBrowserTransport } from "../../src/lib/moth/browser";
import { createServerTransport } from "../../src/lib/moth/server";
import { configuredMothBase } from "../../src/lib/moth/atlas";
import { runJob } from "../../src/lib/moth/job";
import type { MothJobStatus, MothTransport } from "../../src/lib/moth/transport";

type Variant = { label: string; size: number; shots: number; palette: boolean; merged: boolean; diagnosticOnly?: boolean; distortion?: number; expectedError?: string };
const variants: Variant[] = [
  { label: "palette-8-64", size: 8, shots: 64, palette: true, merged: false },
  { label: "merged-8-64", size: 8, shots: 64, palette: false, merged: true },
  { label: "palette-16-256", size: 16, shots: 256, palette: true, merged: false },
  { label: "palette-4-16", size: 4, shots: 16, palette: true, merged: false, diagnosticOnly: true },
  { label: "palette-floor-2-1", size: 2, shots: 1, palette: true, merged: false, diagnosticOnly: true },
  { label: "merged-floor-2-1", size: 2, shots: 1, palette: false, merged: true, diagnosticOnly: true },
];
const extraCases: Variant[] = [
  { label: "standard-16-128", size: 16, shots: 128, palette: false, merged: false },
  { label: "simulator-distortion-control", size: 2, shots: 64, palette: true, merged: false, distortion: 1, expectedError: "distortion_without_hardware", diagnosticOnly: true },
];
const onlyIndex = process.argv.indexOf("--only");
const singleCase = onlyIndex >= 0;
const selected = singleCase ? [...variants, ...extraCases].find((v) => v.label === process.argv[onlyIndex + 1]) : undefined;
if (singleCase) assert.ok(selected, "--only requires a known case label");
const cases = selected ? [selected] : variants;
const submissionLimit = singleCase ? 1 : 8;
const direct = process.argv.includes("--direct");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const paramsFor = (v: Variant) => ({ machine: "aer", shots: v.shots, fixed_palette: v.palette, separate_rgb: !v.merged, distortion: v.distortion ?? 0, range_correction: false });
const specimen = async (id: string) => JSON.parse(await readFile(path.join(root, "public/specimens", id, "manifest.json"), "utf8")) as Specimen;
const inputFor = (s: Specimen, v: Variant): RGBAImage => {
  if (v.size === 2) return { width: 2, height: 2, data: new Uint8ClampedArray([255, 32, 16, 255, 16, 255, 32, 255, 32, 16, 255, 255, 255, 220, 16, 255]) };
  assert.ok(s.colony && s.genome);
  return renderColonySeed(s.colony.bloch, s.colony.correlations, s.genome.bytes, v.size);
};
const colourCount = (img: RGBAImage) => {
  const colours = new Set<string>();
  for (let i = 0; i < img.data.length; i += 4) colours.add(`${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`);
  return colours.size;
};
const initial = await specimen("6a5efd");
for (const v of cases) {
  const img = inputFor(initial, v);
  assert.ok(v.shots > 0 && Number.isInteger(v.shots));
  assert.equal(img.width * img.height, v.size ** 2);
  assert.ok(colourCount(img) > 1);
  assert.equal(decodePng(encodePng(img)).width, v.size);
}
if (!process.argv.includes("--live")) {
  console.log(JSON.stringify({ variants: cases.map((v) => ({ ...v, params: paramsFor(v) })), maxSubmissions: submissionLimit, transport: direct ? "direct" : "local-proxy" }, null, 2));
  console.log(`Offline matrix verified. --live submits at most ${submissionLimit} paid Tessa job(s).`);
  process.exit(0);
}

assert.ok(process.env.MOTH_API_KEY, "MOTH_API_KEY is required");
if (!direct) {
  const localResponse = await fetch("http://localhost:3002/", { method: "HEAD", signal: AbortSignal.timeout(30_000) });
  assert.equal(localResponse.status, 200, "the local proxy server must be available before testing");
}
const metadataResponse = await fetch(`${configuredMothBase()}/engines/tessa-image-v1`, { headers: { Authorization: `Bearer ${process.env.MOTH_API_KEY}` }, signal: AbortSignal.timeout(60_000) });
assert.equal(metadataResponse.status, 200);
const metadata = await metadataResponse.json();
const schema = metadata.params_schema.properties;
for (const v of cases) {
  const params = paramsFor(v);
  for (const key of Object.keys(params)) assert.ok(schema[key], `unsupported parameter: ${key}`);
  assert.ok(schema.machine.enum.includes(params.machine));
  assert.ok(params.shots > schema.shots.exclusiveMinimum);
}
assert.equal(metadata.credits_per_run, 1, "stop if the advertised per-job cost changed");
assert.equal(metadata.enabled, true);

const scratch = await mkdtemp(path.join(tmpdir(), "chrono-tessa-variants-"));
const reportPath = path.join(scratch, "report.json");
const runs: Record<string, unknown>[] = [];
const report = { checkedAt: new Date().toISOString(), engine: metadata.engine_id, creditsPerRun: metadata.credits_per_run, advertisedRunPolicy: metadata.run_policy, variants: cases, transport: direct ? "direct" : "local-proxy", maxSubmissions: submissionLimit, runs, candidate: undefined as string | undefined };
await writeFile(path.join(scratch, "engine.json"), JSON.stringify(metadata, null, 2));
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ reportPath, transport: report.transport, maxSubmissions: submissionLimit, note: "Sequential jobs, no retries; no browser specimen mutation." }));

const baseTransport = direct ? createServerTransport() : createBrowserTransport("http://localhost:3002/api/moth");
let totalSubmissions = 0;
const uploaded = new Map<string, string>();
type Trial = { fastUsable: boolean; pending: boolean };
async function trial(v: Variant, specimenId: string, suffix = ""): Promise<Trial> {
  assert.ok(totalSubmissions < submissionLimit, "overall submission budget exhausted");
  const label = `${v.label}${suffix}`;
  const image = inputFor(await specimen(specimenId), v);
  const png = encodePng(image);
  const hash = sha256(png);
  const params = paramsFor(v);
  const startedAt = new Date().toISOString();
  let jobId: string | undefined;
  let latest: MothJobStatus | undefined;
  let submissions = 0;
  let lastProgress = 0;
  let elapsedMs = 0;
  let engineStartedAt: number | undefined;
  let fastUsable = false;
  let pending = false;
  let outcome: Record<string, unknown>;
  let asset: string | undefined;
  try {
    asset = uploaded.get(hash);
    if (!asset) {
      asset = await baseTransport.uploadAsset(png, `${label}-${specimenId}.png`, "image/png");
      const downloaded = await baseTransport.download({ output_asset_id: asset, filename: "input.png", slot: "image", content_type: "image/png", size_bytes: png.byteLength });
      assert.equal(sha256(downloaded), hash, "input bytes must survive upload unchanged");
      uploaded.set(hash, asset);
    }
    const transport: MothTransport = {
      ...baseTransport,
      submit: async (engine, body) => {
        assert.equal(++submissions, 1, "no retry submissions allowed");
        assert.ok(++totalSubmissions <= submissionLimit, "overall submission budget exhausted");
        assert.deepEqual(body, { input_files: { image: asset }, params });
        jobId = await baseTransport.submit(engine, body);
        console.log(JSON.stringify({ label, jobId, phase: "submitted", totalSubmissions }));
        return jobId;
      },
      status: async (id) => {
        latest = await baseTransport.status(id);
        return latest;
      },
    };
    const t0 = Date.now();
    engineStartedAt = t0;
    const out = await runJob(transport, "tessa-image-v1", { input_files: { image: asset }, params }, {
      maxAttempts: 1, timeoutMs: 120_000,
      onStatus: (event) => {
        elapsedMs = Date.now() - t0;
        if (elapsedMs - lastProgress >= 30_000) {
          lastProgress = elapsedMs;
          console.log(JSON.stringify({ label, jobId, phase: event.phase, elapsedMs }));
        }
      },
    });
    elapsedMs = out.totalMs;
    const output = out.result.outputs?.find((o) => o.content_type.startsWith("image/"));
    assert.ok(output, "completed job must provide an image");
    const bytes = await baseTransport.download(output);
    const skin = decodePng(bytes);
    const colours = colourCount(skin);
    const opaquePixels = skin.data.filter((_, i) => i % 4 === 3).filter((alpha) => alpha > 0).length;
    assert.ok(skin.width > 0 && skin.height > 0 && opaquePixels > 0, "skin must be visible");
    await writeFile(path.join(scratch, `${label}-input.png`), png);
    await writeFile(path.join(scratch, `${label}-skin.png`), bytes);
    // Quality is only a coarse gate. A candidate still requires visual QA and app integration.
    fastUsable = !v.diagnosticOnly && elapsedMs < 50_000 && skin.width >= 8 && skin.height >= 8 && colours > 3;
    outcome = { outcome: "completed", remoteStatus: latest?.status, outputAsset: output.output_asset_id, outputSha256: sha256(bytes), outputDimensions: [skin.width, skin.height], outputColours: colours, fastUsable, expectedError: v.expectedError, expectedRejection: false, unexpectedSuccess: !!v.expectedError };
  } catch (error) {
    if (engineStartedAt != null) elapsedMs = Date.now() - engineStartedAt;
    const e = error as { type?: string; message?: string; status?: number };
    const message = (e.message ?? String(error)).split(process.env.MOTH_API_KEY!).join("[redacted]");
    pending = !!jobId && !["failed", "completed", "cancelled", "canceled"].includes(String(latest?.status));
    const expectedRejection = !!v.expectedError && e.type === v.expectedError;
    outcome = { outcome: expectedRejection ? "expected_rejection" : "failed", remoteStatus: latest?.status, httpStatus: e.status, errorType: e.type, message, pending, expectedError: v.expectedError, expectedRejection };
  }
  const row = { label, specimenId, startedAt, dimensions: [image.width, image.height], inputSha256: hash, asset, params, jobId, submissions, elapsedMs, ...outcome };
  runs.push(row);
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(row));
  return { fastUsable, pending };
}

for (const v of cases) {
  if (totalSubmissions >= submissionLimit) break;
  const first = await trial(v, "6a5efd");
  if (first.pending) {
    console.log("Remote job is unresolved; stop the sweep to avoid accumulating running jobs.");
    break;
  }
  if (singleCase || !first.fastUsable || totalSubmissions > 6) continue;
  const second = await trial(v, "42ac05", "-confirm-2");
  if (second.pending) break;
  if (!second.fastUsable) continue;
  const third = await trial(v, "3fd5b1", "-confirm-3");
  if (third.pending) break;
  if (second.fastUsable && third.fastUsable) {
    report.candidate = v.label;
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    break;
  }
}
console.log(JSON.stringify({ reportPath, totalSubmissions, candidate: report.candidate ?? null, complete: true }));
