/**
 * Grow (or evolve) a Chrono specimen against the live Moth Atlas API and archive it under public/specimens/<id>/.
 *
 *   npx tsx --env-file=.env.local scripts/grow.ts [--machine aer|fake_fez] [--depth 8] [--entanglement 0.45] [--decay 0.5]
 *   npx tsx --env-file=.env.local scripts/grow.ts --evolve <id> [--wounds 4] [--no-audio]
 *   npx tsx --env-file=.env.local scripts/grow.ts --resume <id>        # continue a halted run from its failed stage
 *
 * Writes seed.png, skin.png, mask.png, tissue.png, voice.wav, echo.wav, manifest.json (full Specimen, LUTs inline)
 * and upserts public/specimens/index.json (newest first).
 */
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServerTransport } from "../src/lib/moth/server";
import { ChainHaltedError, evolveChain, growChain, resumeChain, type ArtifactSink, type ChainReporter } from "../src/lib/chain/pipeline";
import { DEFAULT_CONTROLS, type ArchiveIndex, type Controls, type Specimen, type StageId, type Wound } from "../src/lib/chain/types";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const SPECIMENS = path.join(PUBLIC, "specimens");

// ───────────────────────────────────────── args
const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (name: string) => argv.includes(`--${name}`);

const controls: Controls = {
  ...DEFAULT_CONTROLS,
  ...(arg("machine") ? { machine: arg("machine") as Controls["machine"] } : {}),
  ...(arg("depth") ? { circuitDepth: Number(arg("depth")) } : {}),
  ...(arg("entanglement") ? { entanglement: Number(arg("entanglement")) } : {}),
  ...(arg("decay") ? { decay: Number(arg("decay")) } : {}),
};

// ───────────────────────────────────────── node artifact sink
const specimenDir = (id: string) => path.join(SPECIMENS, id);
function urlToPath(url: string): string {
  if (!url.startsWith("/")) throw new Error(`cannot read non-local url ${url}`);
  const p = path.join(PUBLIC, url);
  if (!p.startsWith(PUBLIC)) throw new Error(`path escapes public/: ${url}`);
  return p;
}
const sink: ArtifactSink = {
  async write(id, name, bytes) {
    await mkdir(specimenDir(id), { recursive: true });
    await writeFile(path.join(specimenDir(id), name), bytes);
    return `/specimens/${id}/${name}`;
  },
  async read(url) {
    return new Uint8Array(await readFile(urlToPath(url)));
  },
};

// ───────────────────────────────────────── console reporter
const tag = arg("tag") ?? (arg("evolve") ? `evolve:${arg("evolve")}` : arg("resume") ? `resume:${arg("resume")}` : controls.machine);
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(0).padStart(5)}s`;
let lastStatus = "";
const reporter: ChainReporter = {
  pushLog: (l) => console.log(`[${ts()}] [${tag}] ${l.level.toUpperCase().padEnd(5)} ${l.stage ? `${l.stage}: ` : ""}${l.msg}`),
  setRun: (id, r) => {
    if (!r.status) return;
    const line = `${id}:${r.status}:${r.attempt ?? ""}:${r.jobId ?? ""}`;
    if (line === lastStatus) return;
    lastStatus = line;
    if (r.status === "queued" || r.status === "running" || r.status === "retrying" || r.status === "uploading") {
      console.log(`[${ts()}] [${tag}] ····· ${id} → ${r.status}${r.attempt ? ` (attempt ${r.attempt})` : ""}${r.jobId ? ` job ${r.jobId}` : ""}`);
    }
  },
};

// ───────────────────────────────────────── archive helpers
async function exists(p: string) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const lock = path.join(SPECIMENS, ".index.lock");
  for (let i = 0; ; i++) {
    try {
      await mkdir(lock);
      break;
    } catch {
      if (i > 200) await rm(lock, { recursive: true, force: true });
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

async function writeJsonAtomic(p: string, data: unknown) {
  const tmp = `${p}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n");
  await rename(tmp, p);
}

async function saveManifest(s: Specimen, complete: boolean) {
  await mkdir(specimenDir(s.id), { recursive: true });
  await writeJsonAtomic(path.join(specimenDir(s.id), complete ? "manifest.json" : "manifest.partial.json"), s);
  if (complete) await rm(path.join(specimenDir(s.id), "manifest.partial.json"), { force: true });
}

async function upsertIndex(s: Specimen) {
  await withLock(async () => {
    const p = path.join(SPECIMENS, "index.json");
    let idx: ArchiveIndex = { specimens: [] };
    try {
      idx = JSON.parse(await readFile(p, "utf8")) as ArchiveIndex;
    } catch {
      /* fresh */
    }
    const entry = { id: s.id, name: s.name, createdAt: s.createdAt, generation: s.generation, thumb: s.tissue?.url ?? `/specimens/${s.id}/tissue.png` };
    idx.specimens = [entry, ...idx.specimens.filter((e) => e.id !== s.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    await writeJsonAtomic(p, idx);
  });
}

/** Evolved specimens copy the cached artifacts (seed/skin, and audio when not re-run) so each folder is self-contained. */
async function localizeCached(s: Specimen) {
  const own = async <T extends { url: string }>(a: T | undefined, name: string): Promise<T | undefined> => {
    if (!a?.url || a.url.startsWith(`/specimens/${s.id}/`)) return a;
    const src = urlToPath(a.url);
    if (!(await exists(src))) return a;
    await copyFile(src, path.join(specimenDir(s.id), name));
    return { ...a, url: `/specimens/${s.id}/${name}` };
  };
  if (s.colony) s.colony = { ...s.colony, seed: (await own(s.colony.seed, "seed.png"))! };
  s.skin = await own(s.skin, "skin.png");
  s.voice = await own(s.voice, "voice.wav");
  s.echo = await own(s.echo, "echo.wav");
}

function randomWounds(n: number): Wound[] {
  const now = Date.now();
  return Array.from({ length: n }, (_, i) => ({
    u: Math.round(Math.random() * 1000) / 1000,
    v: Math.round((0.2 + 0.6 * Math.random()) * 1000) / 1000,
    strength: Math.round((0.6 + 0.4 * Math.random()) * 100) / 100,
    t: now + i * 250,
  }));
}

function summary(s: Specimen) {
  const rows = (Object.keys(s.runs) as StageId[]).map((id) => {
    const r = s.runs[id]!;
    return `  ${id.padEnd(14)} ${r.status.padEnd(7)} ${r.latencyMs != null ? `${(r.latencyMs / 1000).toFixed(1)}s`.padStart(8) : "        "}  att ${r.attempt}  job ${r.jobId ?? "-"}\n      ${r.note ?? r.error ?? ""}`;
  });
  return `${s.name} (${s.id}) gen ${s.generation}\n${rows.join("\n")}`;
}

async function loadManifest(id: string, partialOk = false): Promise<Specimen> {
  const dir = specimenDir(id);
  for (const f of partialOk ? ["manifest.partial.json", "manifest.json"] : ["manifest.json"]) {
    const p = path.join(dir, f);
    if (await exists(p)) return JSON.parse(await readFile(p, "utf8")) as Specimen;
  }
  throw new Error(`no manifest for ${id} in ${dir}`);
}

// ───────────────────────────────────────── main
async function main() {
  await mkdir(SPECIMENS, { recursive: true });
  const deps = { transport: createServerTransport(), sink, reporter };
  const evolveId = arg("evolve");
  const resumeId = arg("resume");
  let s: Specimen;
  try {
    if (evolveId) {
      const base = await loadManifest(evolveId);
      const wounds = randomWounds(Number(arg("wounds") ?? 4));
      console.log(`[${ts()}] [${tag}] evolving ${base.id} (gen ${base.generation}) with ${wounds.length} wounds`);
      s = await evolveChain(deps, base, wounds, { ...base.controls, ...pickControlOverrides() }, { withAudio: !flag("no-audio") });
      await localizeCached(s);
    } else if (resumeId) {
      const partial = await loadManifest(resumeId, true);
      s = await resumeChain(deps, partial);
      if (s.generation > 0) await localizeCached(s);
    } else {
      console.log(`[${ts()}] [${tag}] growing new specimen · controls ${JSON.stringify(controls)}`);
      s = await growChain(deps, controls);
    }
  } catch (e) {
    if (e instanceof ChainHaltedError) {
      const partial = e.specimen;
      if (partial.id && partial.id !== "embryo") await saveManifest(partial, false);
      console.error(`\n[${ts()}] [${tag}] HALTED at ${e.stage}: ${(e.cause as Error)?.message ?? e.message}`);
      console.error(summary(partial));
      if (partial.id !== "embryo") console.error(`resume with: npx tsx --env-file=.env.local scripts/grow.ts --resume ${partial.id}`);
      process.exit(2);
    }
    throw e;
  }
  await saveManifest(s, true);
  await upsertIndex(s);
  console.log(`\n[${ts()}] [${tag}] DONE → public/specimens/${s.id}/\n${summary(s)}`);
}

function pickControlOverrides(): Partial<Controls> {
  return {
    ...(arg("machine") ? { machine: arg("machine") as Controls["machine"] } : {}),
    ...(arg("depth") ? { circuitDepth: Number(arg("depth")) } : {}),
    ...(arg("entanglement") ? { entanglement: Number(arg("entanglement")) } : {}),
    ...(arg("decay") ? { decay: Number(arg("decay")) } : {}),
  };
}

main().catch((e) => {
  console.error(`[${ts()}] [${tag}] FATAL`, e);
  process.exit(1);
});
