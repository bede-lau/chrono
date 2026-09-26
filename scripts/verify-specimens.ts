/**
 * Validate every archived specimen: files exist, PNGs decode, WAV headers parse, LUT/soma sizes are sane,
 * every stage has a job id (or is cached). Prints the per-stage latency / job id / attempt table.
 *
 *   npx tsx scripts/verify-specimens.ts [id ...]
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { decodePng } from "../src/lib/imaging";
import { parseWav } from "../src/lib/chain/util";
import { STAGES, type ArchiveIndex, type Specimen } from "../src/lib/chain/types";

const PUBLIC = path.resolve(__dirname, "..", "public");
const problems: string[] = [];
const fail = (id: string, msg: string) => problems.push(`${id}: ${msg}`);

async function bytes(url: string) {
  return new Uint8Array(await readFile(path.join(PUBLIC, url)));
}

async function checkSpecimen(id: string) {
  const s = JSON.parse(await readFile(path.join(PUBLIC, "specimens", id, "manifest.json"), "utf8")) as Specimen;
  const lines: string[] = [];
  for (const [k, img] of [
    ["seed", s.colony?.seed],
    ["skin", s.skin],
    ["mask", s.mask],
    ["tissue", s.tissue],
  ] as const) {
    if (!img) {
      fail(id, `${k} missing`);
      continue;
    }
    try {
      const d = decodePng(await bytes(img.url));
      if (d.width !== img.width || d.height !== img.height) fail(id, `${k} size ${d.width}×${d.height} ≠ manifest ${img.width}×${img.height}`);
      lines.push(`${k} ${d.width}×${d.height}`);
    } catch (e) {
      fail(id, `${k} PNG invalid: ${(e as Error).message}`);
    }
  }
  if (s.mask && s.tissue && (s.mask.width !== s.skin?.width || s.mask.height !== s.skin?.height)) fail(id, "mask size ≠ skin size");
  for (const [k, a] of [
    ["voice", s.voice],
    ["echo", s.echo],
  ] as const) {
    if (!a) {
      fail(id, `${k} missing`);
      continue;
    }
    try {
      const w = parseWav(await bytes(a.url));
      if (w.durationSec < 1) fail(id, `${k} too short (${w.durationSec}s)`);
      lines.push(`${k} ${w.durationSec.toFixed(1)}s ${w.sampleRate}Hz ${w.channels}ch ${w.bitsPerSample}bit`);
    } catch (e) {
      fail(id, `${k} WAV invalid: ${(e as Error).message}`);
    }
  }
  const m = s.membrane;
  if (!m) fail(id, "membrane missing");
  else {
    for (const [k, l] of [
      ["R", m.rLut],
      ["T", m.tLut],
    ] as const) {
      if (l.width * l.height !== l.data.length || l.width < 10) fail(id, `${k} LUT ${l.width}×${l.height} has ${l.data.length} values`);
      if (!l.data.every(Number.isFinite)) fail(id, `${k} LUT has non-finite values`);
    }
    lines.push(`LUT ${m.rLut.width}×${m.rLut.height} R[${Math.min(...m.rLut.data).toFixed(3)}..${Math.max(...m.rLut.data).toFixed(3)}] T[${Math.min(...m.tLut.data).toFixed(3)}..${Math.max(...m.tLut.data).toFixed(3)}] glsl ${m.glsl?.length ?? 0} ch`);
  }
  if (!s.soma || s.soma.grid.length !== s.soma.size * s.soma.size) fail(id, "soma grid size mismatch");
  if (!s.genome || s.genome.bytes.length !== 32 || s.genome.hex.length !== 64) fail(id, "genome not 32 bytes");
  for (const st of STAGES) {
    const r = s.runs[st.id];
    if (!r) fail(id, `run ${st.id} missing`);
    else if (r.status !== "done" && r.status !== "cached") fail(id, `run ${st.id} status ${r.status}`);
    else if (!r.jobId) fail(id, `run ${st.id} has no jobId`);
    else if (!r.note) fail(id, `run ${st.id} has no note`);
  }
  console.log(`\n${s.name} · ${s.id} · gen ${s.generation} · ${s.controls.machine} · wounds ${s.wounds.length} · qubits ${s.metrics?.qubitsUsed} · Σ ${((s.metrics?.totalLatencyMs ?? 0) / 1000).toFixed(1)} s`);
  console.log(`  ${lines.join(" · ")}`);
  for (const st of STAGES) {
    const r = s.runs[st.id];
    if (!r) continue;
    console.log(`  ${st.index} ${st.engineId.padEnd(24)} ${r.status.padEnd(6)} ${r.latencyMs != null ? `${(r.latencyMs / 1000).toFixed(1)}s`.padStart(7) : "".padStart(7)} att ${r.attempt} job ${r.jobId}`);
  }
}

async function main() {
  let ids = process.argv.slice(2);
  const idx = JSON.parse(await readFile(path.join(PUBLIC, "specimens", "index.json"), "utf8")) as ArchiveIndex;
  if (!ids.length) ids = idx.specimens.map((e) => e.id);
  for (const e of idx.specimens) {
    try {
      await stat(path.join(PUBLIC, e.thumb));
    } catch {
      fail(e.id, `thumb ${e.thumb} missing`);
    }
  }
  for (const id of ids) await checkSpecimen(id).catch((e) => fail(id, (e as Error).message));
  console.log(problems.length ? `\n✕ ${problems.length} problem(s):\n  ${problems.join("\n  ")}` : `\n✓ ${ids.length} specimen(s) valid`);
  process.exit(problems.length ? 1 : 0);
}
main();
