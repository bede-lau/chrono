/**
 * The Chrono daisy chain — isomorphic core (browser + Node).
 *
 * Every stage is a different Moth Atlas engine and consumes the previous stage's artifact:
 *   comet-qrng → graph → tessa-image → blur (skin output_asset_id + wound mask) → blur-core (tissue luma)
 *   → entanglement-shader (tissue + soma metrics) → qrc-audio (LUT-voiced chunks) → retrocausal-echo (song output_asset_id)
 *
 * Dependencies are injected so the same code runs in the browser (proxy transport, blob URLs, zustand reporter)
 * and in Node (direct transport, files under public/specimens, console reporter).
 * A failed stage halts the chain: downstream stages never run and the organism goes dormant.
 */
import {
  decodePng,
  encodePng,
  imageMetrics,
  lumaGrid,
  readShaderZip,
  renderColonySeed,
  renderWoundMask,
  type RGBAImage,
} from "../imaging";
import { synthesizeVocabulary, zipChunks } from "../audio";
import { runJob, type JobEvent, type JobOutcome, type RunJobOptions } from "../moth/job";
import { MothError, isAbortError } from "../moth/errors";
import type { MothOutput, MothTransport } from "../moth/transport";
import {
  STAGES,
  type BlochVector,
  type ColonyArtifact,
  type Controls,
  type GenomeArtifact,
  type ImageArtifact,
  type LogLine,
  type MembraneArtifact,
  type SomaArtifact,
  type Specimen,
  type SpecimenMetrics,
  type StageId,
  type StageRun,
  type Wound,
} from "./types";
import {
  bytesToHex,
  clamp,
  flattenNumbers,
  fx,
  hex2,
  hex8,
  hexToBytes,
  meanLumaDelta,
  parseWav,
  quantile,
  retint,
  round,
  roundSig,
  sha256Hex,
  uint32BE,
} from "./util";

// ───────────────────────────────────────────────────────────────── injected dependencies

export type ChainMode = "idle" | "growing" | "evolving";

/** Where artifacts are persisted. Browser: blob URLs. Node: files under public/specimens/<id>/. */
export interface ArtifactSink {
  /** Persist bytes for a specimen; returns the URL the manifest/UI should use. */
  write(specimenId: string, name: string, bytes: Uint8Array, contentType: string): Promise<string>;
  /** Read back bytes previously written (or any artifact URL: /specimens/..., blob:, data:). */
  read(url: string): Promise<Uint8Array>;
}

/** Progress sink. Every method optional — Node runs log to the console, browser runs drive useChrono. */
export interface ChainReporter {
  setSpecimen?(s: Specimen): void;
  patchSpecimen?(p: Partial<Specimen>): void;
  setRun?(id: StageId, r: Partial<StageRun>): void;
  setMode?(m: ChainMode, active?: StageId | null): void;
  pushLog?(l: Omit<LogLine, "t">): void;
}

export interface ChainDeps {
  transport: MothTransport;
  sink: ArtifactSink;
  reporter?: ChainReporter;
}

export interface ChainOptions {
  signal?: AbortSignal;
  /** Override per-engine RunJobOptions (tests / scripts). */
  jobOptions?: Partial<Record<string, Partial<RunJobOptions>>>;
}

export class ChainHaltedError extends Error {
  readonly stage: StageId;
  readonly specimen: Specimen;
  readonly cause?: unknown;
  constructor(stage: StageId, specimen: Specimen, cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    super(`Chain halted at ${stage}: ${msg}`);
    this.name = "ChainHaltedError";
    this.stage = stage;
    this.specimen = specimen;
    this.cause = cause;
  }
}

// ───────────────────────────────────────────────────────────────── constants

export const STAGE_ORDER: StageId[] = STAGES.map((s) => s.id);
const ENGINE: Record<StageId, string> = Object.fromEntries(STAGES.map((s) => [s.id, s.engineId])) as Record<StageId, string>;
export const SEED_SIZE = 32;
export const LUT_RESOLUTION = 48;
export const MASK_BASELINE = 0.35;
/** entanglement-shader-v1 21-qubit budget, measured 2026-09-26: max incoming_rays per layer count. */
const SHADER_MAX_RAYS: Record<number, number> = { 1: 10, 2: 9, 3: 8, 4: 8 };
const QRC_FAST_TIMEOUT_MS = 8 * 60_000;
/** Deterministic re-tints (hue°, chroma gain) tried when Atlas' upload verifier rejects a generated seed. */
const SEED_RETINTS: [number, number][] = [
  [120, 1.4],
  [240, 1.4],
  [60, 1.6],
  [180, 1.8],
  [300, 1.5],
];

/** Atlas upload verification rejected the file ("complete asset …: not a valid asset", 422). */
function isRejectedAsset(e: unknown): boolean {
  return e instanceof MothError && e.status === 422 && /not a valid asset/i.test(e.message);
}

// ───────────────────────────────────────────────────────────────── run context

interface Ctx {
  deps: ChainDeps;
  s: Specimen;
  controls: Controls;
  mode: ChainMode;
  wounds: Wound[];
  signal?: AbortSignal;
  opts: ChainOptions;
  /** Decoded images kept in memory across stages (avoids re-reading from the sink). */
  mem: { seed?: RGBAImage; seedPng?: Uint8Array; skin?: RGBAImage; skinPng?: Uint8Array; tissue?: RGBAImage };
}

function log(ctx: Ctx, level: LogLine["level"], msg: string, stage?: StageId) {
  try {
    ctx.deps.reporter?.pushLog?.({ level, msg, stage });
  } catch {
    /* ignore */
  }
}

function patch(ctx: Ctx, p: Partial<Specimen>) {
  Object.assign(ctx.s, p);
  try {
    ctx.deps.reporter?.patchSpecimen?.(p);
  } catch {
    /* ignore */
  }
}

function setRun(ctx: Ctx, id: StageId, r: Partial<StageRun>) {
  const prev: StageRun = ctx.s.runs[id] ?? { id, status: "idle", attempt: 0 };
  ctx.s.runs = { ...ctx.s.runs, [id]: { ...prev, ...r, id } };
  try {
    ctx.deps.reporter?.setRun?.(id, r);
  } catch {
    /* ignore */
  }
}

function patchMetrics(ctx: Ctx, m: Partial<SpecimenMetrics>) {
  patch(ctx, { metrics: { ...(ctx.s.metrics ?? {}), ...m } });
}

async function readPng(ctx: Ctx, img: ImageArtifact | undefined, what: string): Promise<{ png: Uint8Array; rgba: RGBAImage }> {
  if (!img?.url) throw new Error(`${what} artifact missing`);
  const png = await ctx.deps.sink.read(img.url);
  return { png, rgba: decodePng(png) };
}

/** Stage handle: wraps uploads + jobs so the StageRun records params, inputs, job id, attempts and latency. */
interface StageHandle {
  id: StageId;
  upload(bytes: Uint8Array, filename: string, contentType: string): Promise<string>;
  job(body: { input_files?: Record<string, string>; params?: Record<string, unknown> }, opts?: Partial<RunJobOptions>): Promise<JobOutcome>;
  download(outcome: JobOutcome, pick: (o: MothOutput) => boolean, what: string): Promise<{ bytes: Uint8Array; output: MothOutput }>;
}

async function withRetries<T>(ctx: Ctx, what: string, fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    if (ctx.signal?.aborted) throw abortErr();
    try {
      return await fn();
    } catch (e) {
      if (isAbortError(e)) throw e;
      last = e;
      if (e instanceof MothError && !e.retryable) throw e;
      if (i < tries - 1) {
        log(ctx, "warn", `${what} failed (${(e as Error).message}); retrying`);
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      }
    }
  }
  throw last;
}

function abortErr() {
  const e = new Error("Aborted");
  e.name = "AbortError";
  return e;
}

function handle(ctx: Ctx, id: StageId): StageHandle {
  const engineId = ENGINE[id];
  let accumulatedInputs: Record<string, string> = {};
  return {
    id,
    async upload(bytes, filename, contentType) {
      setRun(ctx, id, { status: "uploading" });
      const assetId = await withRetries(ctx, `upload ${filename}`, () => ctx.deps.transport.uploadAsset(bytes, filename, contentType));
      log(ctx, "info", `uploaded ${filename} (${bytes.byteLength} B) → asset ${assetId.slice(0, 8)}`, id);
      return assetId;
    },
    async job(body, over = {}) {
      accumulatedInputs = { ...(body.input_files ?? {}) };
      setRun(ctx, id, {
        status: "queued",
        params: body.params,
        inputs: Object.keys(accumulatedInputs).length ? accumulatedInputs : undefined,
      });
      const onStatus = (e: JobEvent) => {
        switch (e.phase) {
          case "submitting":
            setRun(ctx, id, { status: e.attempt > 1 ? "retrying" : "queued", attempt: e.attempt });
            break;
          case "queued":
            setRun(ctx, id, { status: "queued", attempt: e.attempt, jobId: e.jobId });
            break;
          case "processing":
            setRun(ctx, id, { status: "running", attempt: e.attempt, jobId: e.jobId });
            break;
          case "retrying":
            setRun(ctx, id, { status: "retrying", attempt: e.attempt, error: e.error });
            log(ctx, "warn", `${engineId} attempt ${e.attempt - 1} failed (${e.errorType ?? "error"}); retry ${e.attempt}/${e.maxAttempts} in ${Math.round((e.retryInMs ?? 0) / 1000)} s`, id);
            break;
          case "completed":
            setRun(ctx, id, { jobId: e.jobId, attempt: e.attempt, error: undefined });
            break;
          case "failed":
            setRun(ctx, id, { jobId: e.jobId, attempt: e.attempt, error: e.error });
            break;
        }
        ctx.opts.jobOptions?.[engineId]?.onStatus?.(e);
      };
      const outcome = await runJob(ctx.deps.transport, engineId, body, {
        signal: ctx.signal,
        ...(ctx.opts.jobOptions?.[engineId] ?? {}),
        ...over,
        onStatus,
      });
      setRun(ctx, id, { jobId: outcome.jobId, attempt: outcome.attempt, latencyMs: outcome.latencyMs });
      return outcome;
    },
    async download(outcome, pick, what) {
      const outputs = outcome.result?.outputs ?? outcome.status.outputs ?? [];
      const output = outputs.find(pick);
      if (!output) {
        throw new MothError({
          status: 502,
          type: "missing_output",
          message: `${engineId} returned no ${what} (outputs: ${outputs.map((o) => `${o.slot}:${o.content_type}`).join(", ") || "none"})`,
          retryable: false,
        });
      }
      const bytes = await withRetries(ctx, `download ${what}`, () => ctx.deps.transport.download(output));
      return { bytes, output };
    },
  };
}

interface StageResult {
  note: string;
}

async function execStage(ctx: Ctx, id: StageId, body: (h: StageHandle) => Promise<StageResult>): Promise<void> {
  if (ctx.signal?.aborted) throw abortErr();
  const startedAt = Date.now();
  setRun(ctx, id, {
    status: "queued",
    attempt: 0,
    startedAt,
    finishedAt: undefined,
    latencyMs: undefined,
    jobId: undefined,
    error: undefined,
    note: undefined,
    params: undefined,
    inputs: undefined,
  });
  ctx.deps.reporter?.setMode?.(ctx.mode, id);
  log(ctx, "info", `${ENGINE[id]} ▸ ${STAGES.find((s) => s.id === id)?.title}`, id);
  try {
    const { note } = await body(handle(ctx, id));
    const run = ctx.s.runs[id];
    setRun(ctx, id, { status: "done", finishedAt: Date.now(), note, error: undefined });
    log(ctx, "ok", `${ENGINE[id]} ✓ ${run?.latencyMs != null ? `${(run.latencyMs / 1000).toFixed(1)} s` : ""}${run && run.attempt > 1 ? ` (attempt ${run.attempt})` : ""} — ${note}`, id);
  } catch (e) {
    const aborted = isAbortError(e) || ctx.signal?.aborted;
    const msg = aborted ? "aborted" : e instanceof Error ? e.message : String(e);
    setRun(ctx, id, { status: "failed", finishedAt: Date.now(), error: msg });
    log(ctx, "error", `${ENGINE[id]} ✕ ${msg} — chain halted, organism dormant`, id);
    if (aborted) throw e;
    throw new ChainHaltedError(id, ctx.s, e);
  }
}

// ───────────────────────────────────────────────────────────────── stages

/** 0 · Genesis — comet-qrng-v1: Born-rule measurements → 256-bit genome. */
async function genesis(ctx: Ctx, h: StageHandle): Promise<StageResult> {
  const params = { num_qubits: 12, shots: 4096, mode: "emu", output_bytes: 32, bell_witness: false, include_raw_counts: true };
  const out = await h.job({ params });
  const o = ((out.result?.result as { output?: unknown } | undefined)?.output ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const random = (o.random ?? {}) as { bytes?: number; hex?: string };
  const hBit: number | undefined = o.pulse?.entropy?.h_bit ?? o.entropy?.h_bit ?? o.entropy_report?.h_bit;
  const commit: string | undefined = o.commitment?.commit ?? o.pulse?.commitment?.commit;
  const rawBits = params.num_qubits * params.shots;
  let genome: GenomeArtifact;
  let note: string;
  const extracted = random.hex ? hexToBytes(random.hex) : [];
  if (extracted.length >= 32) {
    const bytes = extracted.slice(0, 32);
    genome = { hex: bytesToHex(bytes), bytes, source: "qrng", minEntropyPerBit: hBit, commit };
    note = `genome ${genome.hex.slice(0, 8)}… ← 32 B Toeplitz-extracted from ${rawBits} Born-rule bits (12q × 4096 shots${hBit != null ? `, h=${fx(hBit, 3)} b/bit` : ""})`;
  } else {
    const raw = (o.raw ?? {}) as { counts?: unknown; counts_sha256?: string; n_unique_bitstrings?: number };
    let hex: string;
    if (raw.counts && typeof raw.counts === "object") hex = await sha256Hex(JSON.stringify(raw.counts));
    else if (typeof raw.counts_sha256 === "string" && /^[0-9a-f]{64}$/i.test(raw.counts_sha256)) hex = raw.counts_sha256.toLowerCase();
    else throw new MothError({ status: 502, type: "no_entropy", message: "comet-qrng returned neither random bytes nor raw counts" });
    const bytes = hexToBytes(hex);
    genome = { hex, bytes, source: "qrng-counts", minEntropyPerBit: hBit, commit };
    note = `genome = SHA-256(raw counts, ${raw.n_unique_bitstrings ?? "?"} unique of ${params.shots} shots × 12q) — extractor certified ${extracted.length} B${hBit != null ? ` (h=${fx(hBit, 3)} b/bit)` : ""}`;
  }
  const id = genome.hex.slice(0, 6);
  patch(ctx, { genome, id, name: `Specimen ${genome.hex.slice(0, 4).toUpperCase()}` });
  patchMetrics(ctx, { qubitsUsed: params.num_qubits });
  return { note };
}

function colonyGraph(genome: number[]) {
  const n = 6 + (genome[4] % 5);
  const seed = uint32BE(genome, 0);
  const edges: [number, number][] = [];
  const key = (a: number, b: number) => `${Math.min(a, b)},${Math.max(a, b)}`;
  const ring = new Set<string>();
  for (let i = 0; i < n; i++) {
    const a = i;
    const b = (i + 1) % n;
    edges.push([Math.min(a, b), Math.max(a, b)]);
    ring.add(key(a, b));
  }
  let bit = 0;
  let chords = 0;
  for (let a = 0; a < n; a++) {
    for (let b = a + 2; b < n; b++) {
      if (ring.has(key(a, b))) continue;
      const byte = genome[16 + ((bit >> 3) % 16)];
      const set = (byte >> (bit & 7)) & 1;
      bit++;
      if (set) {
        edges.push([a, b]);
        chords++;
      }
    }
  }
  return { n, seed, edges, chords };
}

/** 1 · Colony — graph-v1: genome seed → Bloch vectors (cell nuclei) + ZZ membrane couplings → 32×32 seed PNG. */
async function colony(ctx: Ctx, h: StageHandle): Promise<StageResult> {
  const g = ctx.s.genome!.bytes;
  const { n, seed, edges, chords } = colonyGraph(g);
  const params = { num_qubits: n, seed, shots: 1024, mode: "emu", coupling_map: edges };
  const out = await h.job({ params });
  const o = ((out.result?.result as { output?: unknown } | undefined)?.output ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const blochRaw = (o.tomography?.bloch ?? {}) as Record<string, { X?: number; Y?: number; Z?: number }>;
  const rel = (o.tomography?.relationships ?? {}) as Record<string, Record<string, number>>;
  const bloch: BlochVector[] = [];
  for (let i = 0; i < n; i++) {
    const b = blochRaw[String(i)] ?? {};
    bloch.push({ x: b.X ?? 0, y: b.Y ?? 0, z: b.Z ?? 0 });
  }
  if (!Object.keys(blochRaw).length) throw new MothError({ status: 502, type: "bad_result", message: "graph-v1 returned no tomography.bloch" });
  const correlations = edges.map(([a, b]) => ({ a, b, zz: rel[`${a},${b}`]?.ZZ ?? rel[`${b},${a}`]?.ZZ ?? 0 }));
  const dominant: string = o.dominant_bitstring ?? "";

  const seedImg = renderColonySeed(bloch, correlations, g, SEED_SIZE);
  const seedPng = encodePng(seedImg);
  ctx.mem.seed = seedImg;
  ctx.mem.seedPng = seedPng;
  const url = await ctx.deps.sink.write(ctx.s.id, "seed.png", seedPng, "image/png");
  const col: ColonyArtifact = {
    numQubits: n,
    bloch,
    correlations,
    dominant,
    seed: { url, width: seedImg.width, height: seedImg.height },
  };
  patch(ctx, { colony: col });
  patchMetrics(ctx, { qubitsUsed: (ctx.s.metrics?.qubitsUsed ?? 0) + n });
  const meanR = bloch.reduce((s, b) => s + Math.hypot(b.x, b.y, b.z), 0) / n;
  const zz = correlations.map((c) => c.zz);
  return {
    note: `${n} qubits ← genome[4]=${hex2(g[4])} · seed ${hex8(seed)} ← genome[0..3] · ring ${n} + ${chords} chords · mean |r| ${fx(meanR)} · ⟨ZZ⟩ ${fx(Math.min(...zz), 2, true)}…${fx(Math.max(...zz), 2, true)} → ${seedImg.width}×${seedImg.height} seed`,
  };
}

/** 2 · Morphogenesis — tessa-image-v1: colony seed PNG (uploaded) → quantum skin PNG. */
async function morphogenesis(ctx: Ctx, h: StageHandle): Promise<StageResult> {
  const col = ctx.s.colony!;
  let seedPng = ctx.mem.seedPng ?? (await ctx.deps.sink.read(col.seed.url));
  let seedImg = ctx.mem.seed ?? decodePng(seedPng);
  let seedAsset = col.seed.assetId;
  let retinted = "";
  if (!seedAsset) {
    // Atlas verifies uploaded images (content labelling) and rejects some abstract patterns with 422
    // "not a valid asset". The rejection is content-specific, so fall back to deterministic re-tints.
    for (let i = 0; ; i++) {
      try {
        seedAsset = await h.upload(seedPng, `${ctx.s.id}-seed${i ? `-t${i}` : ""}.png`, "image/png");
        break;
      } catch (e) {
        if (!isRejectedAsset(e) || i >= SEED_RETINTS.length) throw e;
        const [hue, sat] = SEED_RETINTS[i];
        log(ctx, "warn", `Atlas rejected the seed image (${(e as Error).message}); re-tinting hue ${hue}° × sat ${sat}`, "morphogenesis");
        const base = ctx.mem.seed ?? decodePng(await ctx.deps.sink.read(col.seed.url));
        seedImg = retint(base, hue, sat) as RGBAImage;
        seedPng = encodePng(seedImg);
        retinted = ` · seed re-tinted (hue ${hue}°, sat ×${sat}) after Atlas rejected the original upload`;
      }
    }
    let seedUrl = col.seed.url;
    if (retinted) {
      await ctx.deps.sink.write(ctx.s.id, "seed.original.png", ctx.mem.seedPng ?? (await ctx.deps.sink.read(col.seed.url)), "image/png");
      seedUrl = await ctx.deps.sink.write(ctx.s.id, "seed.png", seedPng, "image/png");
    }
    ctx.mem.seed = seedImg;
    ctx.mem.seedPng = seedPng;
    patch(ctx, { colony: { ...col, seed: { ...col.seed, url: seedUrl, assetId: seedAsset } } });
  }
  const machine = ctx.controls.machine;
  const params = { machine, shots: 1024 };
  const out = await h.job({ input_files: { image: seedAsset }, params });
  const { bytes, output } = await h.download(out, (o) => /^image\//.test(o.content_type) || /\.png$/i.test(o.filename), "skin image");
  const skinImg = decodePng(bytes);
  ctx.mem.skin = skinImg;
  ctx.mem.skinPng = bytes;
  const url = await ctx.deps.sink.write(ctx.s.id, "skin.png", bytes, "image/png");
  patch(ctx, { skin: { url, assetId: output.output_asset_id, width: skinImg.width, height: skinImg.height } });
  const px = skinImg.width * skinImg.height;
  const fieldQubits = Math.ceil(Math.log2(px)) + 1;
  patchMetrics(ctx, { qubitsUsed: (ctx.s.metrics?.qubitsUsed ?? 0) + 3 * fieldQubits });
  const d = meanLumaDelta(seedImg, skinImg);
  return {
    note: `${seedImg.width}×${seedImg.height} seed → colour-sphere encode/measure/decode on ${machine === "aer" ? "aer (ideal)" : `${machine} (IBM noise model)`}, 1024 shots/field → skin ${skinImg.width}×${skinImg.height}${d != null ? ` · mean |ΔL| ${fx(d, 3)} vs seed` : ""}${retinted}`,
  };
}

/** 3 · Decoherence — blur-v1: skin output_asset_id (no re-upload) + wound mask → aged tissue. */
async function decoherence(ctx: Ctx, h: StageHandle): Promise<StageResult> {
  const skin = ctx.s.skin!;
  const W = skin.width;
  const H = skin.height;
  const wounds = ctx.wounds;
  let baseline = MASK_BASELINE;
  let maskPng = encodePng(renderWoundMask(wounds, W, H, baseline));
  let maskAsset: string;
  for (let i = 0; ; i++) {
    try {
      maskAsset = await h.upload(maskPng, `${ctx.s.id}-g${ctx.s.generation}-mask${i ? `-${i}` : ""}.png`, "image/png");
      break;
    } catch (e) {
      if (!isRejectedAsset(e) || i >= 3) throw e;
      baseline = round(MASK_BASELINE + 0.02 * (i + 1), 2);
      log(ctx, "warn", `Atlas rejected the wound mask; retrying with baseline ${baseline}`, "decoherence");
      maskPng = encodePng(renderWoundMask(wounds, W, H, baseline));
    }
  }
  const maskUrl = await ctx.deps.sink.write(ctx.s.id, "mask.png", maskPng, "image/png");
  patch(ctx, { mask: { url: maskUrl, assetId: maskAsset, width: W, height: H }, wounds });
  const { decay, entanglement } = ctx.controls;
  const params = { strength: round(0.25 + 0.6 * decay), reach: round(0.8 * entanglement), style: "rx" };

  let imageAsset = skin.assetId;
  let reuploaded = false;
  if (!imageAsset) {
    const png = ctx.mem.skinPng ?? (await ctx.deps.sink.read(skin.url));
    imageAsset = await h.upload(png, `${ctx.s.id}-skin.png`, "image/png");
    reuploaded = true;
  }
  let out: JobOutcome;
  try {
    out = await h.job({ input_files: { image: imageAsset, mask: maskAsset }, params });
  } catch (e) {
    // The Tessa output asset may have expired (archived specimen evolved days later): re-upload the skin once.
    if (reuploaded || !(e instanceof MothError) || e.retryable || isAbortError(e)) throw e;
    log(ctx, "warn", `skin asset ${imageAsset.slice(0, 8)} not usable (${e.type}); re-uploading skin`, "decoherence");
    const png = ctx.mem.skinPng ?? (await ctx.deps.sink.read(skin.url));
    imageAsset = await h.upload(png, `${ctx.s.id}-skin.png`, "image/png");
    reuploaded = true;
    out = await h.job({ input_files: { image: imageAsset, mask: maskAsset }, params });
  }
  const { bytes, output } = await h.download(out, (o) => /^image\//.test(o.content_type) || /\.png$/i.test(o.filename), "tissue image");
  const tissueImg = decodePng(bytes);
  ctx.mem.tissue = tissueImg;
  const url = await ctx.deps.sink.write(ctx.s.id, "tissue.png", bytes, "image/png");
  const m = imageMetrics(tissueImg);
  patch(ctx, { tissue: { url, assetId: output.output_asset_id, width: tissueImg.width, height: tissueImg.height } });
  patchMetrics(ctx, { entropy: m.entropy, meanLuma: m.meanLuma, hueSkew: m.hueSkew, qubitsUsed: (ctx.s.metrics?.qubitsUsed ?? 0) + Math.ceil(Math.log2(Math.max(W, H))) * 2 });
  return {
    note: `strength ${fx(params.strength)} ← decay ${fx(decay)} · reach ${fx(params.reach)} ← entanglement ${fx(entanglement)} · mask ${wounds.length} wound${wounds.length === 1 ? "" : "s"} + ${baseline} baseline · skin ${reuploaded ? "re-uploaded" : `chained as output asset ${imageAsset.slice(0, 8)}`} → tissue entropy ${fx(m.entropy)} bits, mean luma ${fx(m.meanLuma)}`,
  };
}

/** 4 · Soma — blur-core-v1: 32×32 tissue luminance grid → non-local displacement field. */
async function soma(ctx: Ctx, h: StageHandle): Promise<StageResult> {
  const tissue = ctx.mem.tissue ?? (await readPng(ctx, ctx.s.tissue, "tissue")).rgba;
  ctx.mem.tissue = tissue;
  const N = 32;
  const values = lumaGrid(tissue, N).map((row) => row.map((v) => round(v, 4)));
  const { entanglement } = ctx.controls;
  const params = { values, strength: round(0.3 + 0.5 * entanglement), reach: round(entanglement), style: "xy" };
  const out = await h.job({ params });
  const flat = flattenNumbers((out.result?.result as { output?: unknown } | undefined)?.output);
  if (flat.length < 4) throw new MothError({ status: 502, type: "bad_result", message: `blur-core-v1 returned ${flat.length} values` });
  const size = Math.round(Math.sqrt(flat.length));
  // blur-core returns a peak-normalised interference pattern spanning ~8 decades (one bright focus + echoes);
  // a linear rescale would be a single spike, so the displacement field is its log-magnitude, 2nd pct → max.
  const logs = flat.map((v) => Math.log10(Math.max(v, 0) + 1e-9));
  const lo = quantile(logs, 0.02);
  const hi = Math.max(...logs);
  const span = hi - lo || 1;
  const grid = logs.map((v) => round(clamp((v - lo) / span, 0, 1), 4));
  const decades = hi - lo;
  const mean = grid.reduce((a, b) => a + b, 0) / grid.length;
  const variance = grid.reduce((a, b) => a + (b - mean) * (b - mean), 0) / grid.length;
  const inMean = values.flat().reduce((a, b) => a + b, 0) / (N * N);
  const art: SomaArtifact = { size, grid, variance: round(variance, 5) };
  patch(ctx, { soma: art });
  patchMetrics(ctx, { displacementVariance: art.variance, qubitsUsed: (ctx.s.metrics?.qubitsUsed ?? 0) + Math.ceil(Math.log2(N)) * 2 });
  return {
    note: `values = tissue luma ${N}×${N} (mean ${fx(inMean)}) · strength ${fx(params.strength)}, reach ${fx(params.reach)} ← entanglement ${fx(entanglement)} · style xy → log-magnitude field over ${fx(decades, 1)} decades, σ ${fx(Math.sqrt(variance), 3)}`,
  };
}

function shaderParams(ctx: Ctx) {
  const m = ctx.s.metrics ?? {};
  const entropy = m.entropy ?? 4;
  const meanLuma = m.meanLuma ?? 0.5;
  const hueSkew = m.hueSkew ?? 0;
  const sigma = Math.sqrt(ctx.s.soma?.variance ?? 0);
  const normVariance = clamp(2 * sigma, 0, 1); // σ of a 0..1 field is ≤ 0.5
  const layers = 1 + Math.round(3 * normVariance);
  const g5 = ctx.s.genome!.bytes[5];
  const wantRays = layers + 4 + (g5 % 4);
  const incoming_rays = Math.max(layers, Math.min(wantRays, SHADER_MAX_RAYS[layers] ?? 8));
  const style: MembraneArtifact["params"]["style"] = entropy < 3 ? "3-body" : entropy < 5 ? "peaked" : entropy < 6.5 ? "frustrated" : "constrained";
  const params: MembraneArtifact["params"] = {
    reflectance: round(clamp(0.08 + 0.6 * meanLuma, 0.05, 0.9)),
    absorption: round(clamp(entropy / 8, 0.1, 0.98)),
    layers,
    incoming_rays,
    interaction: round(clamp(2 * hueSkew, -2, 2)),
    style,
    resolution: LUT_RESOLUTION,
  };
  return { params, entropy, meanLuma, hueSkew, sigma, wantRays, g5 };
}

/** 5 · Membrane — entanglement-shader-v1: params from tissue entropy/luma/hue + soma variance → R/T LUTs + GLSL. */
async function membrane(ctx: Ctx, h: StageHandle): Promise<StageResult> {
  const d = shaderParams(ctx);
  let params = d.params;
  let out: JobOutcome;
  try {
    out = await h.job({ params });
  } catch (e) {
    // Budget table drifted? The engine tells us the max: "incoming_rays must be at most N".
    const m = e instanceof MothError && e.type === "max_qubits_exceeded" ? /at most (\d+)/.exec(e.message) : null;
    if (!m) throw e;
    params = { ...params, incoming_rays: Math.max(params.layers, Number(m[1])) };
    out = await h.job({ params });
  }
  const { bytes } = await h.download(out, (o) => /zip/.test(o.content_type) || /\.zip$/i.test(o.filename), "shader zip");
  const z = readShaderZip(bytes);
  const lut = (l: typeof z.rLut) => ({ width: l.width, height: l.height, data: Array.from(l.data, (v) => roundSig(v, 5)) });
  const art: MembraneArtifact = { params, rLut: lut(z.rLut), tLut: lut(z.tLut), glsl: z.glsl };
  patch(ctx, { membrane: art });
  patchMetrics(ctx, { qubitsUsed: (ctx.s.metrics?.qubitsUsed ?? 0) + params.layers + params.incoming_rays });
  const capped = params.incoming_rays < d.wantRays ? ` (capped from ${d.wantRays} by 21-qubit budget)` : "";
  return {
    note: `reflectance ${fx(params.reflectance)} ← mean luma ${fx(d.meanLuma)} · absorption ${fx(params.absorption)} ← entropy ${fx(d.entropy)} bits · layers ${params.layers} ← soma σ ${fx(d.sigma, 3)} · rays ${params.incoming_rays} ← layers+4+genome[5]%4${capped} · interaction ${fx(params.interaction, 2, true)} ← hue skew ${fx(d.hueSkew, 2, true)} · style ${params.style} → ${art.rLut.width}×${art.rLut.height} R/T LUTs`,
  };
}

const isAudio = (o: MothOutput) => /^audio\//.test(o.content_type) || /\.wav$/i.test(o.filename);

/** 6 · Voice — qrc-audio-v1: membrane-voiced chunk vocabulary (zip) → reservoir-sequenced song. */
async function voice(ctx: Ctx, h: StageHandle): Promise<StageResult> {
  const chunks = synthesizeVocabulary(ctx.s.membrane!, ctx.s.soma!, ctx.s.genome!);
  const zip = zipChunks(chunks);
  const chunksAsset = await h.upload(zip, `${ctx.s.id}-g${ctx.s.generation}-vocabulary.zip`, "application/zip");
  const g = ctx.s.genome!.bytes;
  const seed = uint32BE(g, 8);
  const { entanglement } = ctx.controls;
  const base = { length: 16, seed, variation: round(0.6 + entanglement), crossfade: 120, loop: true };
  let quality: "fast" | "instant" = "fast";
  let fallback = "";
  let out: JobOutcome;
  try {
    out = await h.job({ input_files: { chunks: chunksAsset }, params: { ...base, quality } }, { timeoutMs: QRC_FAST_TIMEOUT_MS, maxAttempts: 2 });
  } catch (e) {
    if (isAbortError(e)) throw e;
    const why = e instanceof MothError ? (e.type === "client_timeout" ? `fast > ${QRC_FAST_TIMEOUT_MS / 60000} min` : `fast failed: ${e.type}`) : "fast failed";
    log(ctx, "warn", `qrc-audio-v1 ${why}; falling back to quality "instant"`, "voice");
    quality = "instant";
    fallback = ` (fallback: ${why})`;
    out = await h.job({ input_files: { chunks: chunksAsset }, params: { ...base, quality } });
  }
  const { bytes, output } = await h.download(out, isAudio, "song wav");
  const wav = parseWav(bytes);
  const url = await ctx.deps.sink.write(ctx.s.id, "voice.wav", bytes, "audio/wav");
  patch(ctx, { voice: { url, assetId: output.output_asset_id, durationSec: round(wav.durationSec, 2) } });
  return {
    note: `${chunks.length} chunks voiced from LUT rows × soma peaks → reservoir (quality ${quality}${fallback}) seed ${hex8(seed)} ← genome[8..11] · variation ${fx(base.variation)} ← entanglement ${fx(entanglement)} → ${base.length}-chunk song ${fx(wav.durationSec, 1)} s`,
  };
}

/** 7 · Echo — retrocausal-echo-v1: song output_asset_id → quantum multi-tap echo. */
async function echo(ctx: Ctx, h: StageHandle): Promise<StageResult> {
  const v = ctx.s.voice!;
  let audioAsset = v.assetId;
  let reuploaded = false;
  if (!audioAsset) {
    audioAsset = await h.upload(await ctx.deps.sink.read(v.url), `${ctx.s.id}-voice.wav`, "audio/wav");
    reuploaded = true;
  }
  const entropy = ctx.s.metrics?.entropy ?? 4;
  const { circuitDepth, decay } = ctx.controls;
  const nSites = clamp(ctx.s.colony?.numQubits ?? 8, 2, 156);
  let params: Record<string, unknown> = {
    n_sites: nSites,
    depth: clamp(Math.round(circuitDepth), 1, 32),
    theta_x: round(clamp(0.3 + (1.2 * entropy) / 8, 0, Math.PI)),
    mix: 0.55,
    feedback: round(clamp(0.3 * decay, 0, 0.95)),
    machine: "aer",
    negative_mode: "invert",
  };
  let out: JobOutcome;
  try {
    out = await h.job({ input_files: { audio: audioAsset }, params });
  } catch (e) {
    if (!(e instanceof MothError) || e.type !== "audio_too_long") throw e;
    params = { ...params, tail_ms: 1500 };
    out = await h.job({ input_files: { audio: audioAsset }, params });
  }
  const { bytes, output } = await h.download(out, isAudio, "echo wav");
  const wav = parseWav(bytes);
  const url = await ctx.deps.sink.write(ctx.s.id, "echo.wav", bytes, "audio/wav");
  patch(ctx, { echo: { url, assetId: output.output_asset_id, durationSec: round(wav.durationSec, 2) } });
  patchMetrics(ctx, { qubitsUsed: (ctx.s.metrics?.qubitsUsed ?? 0) + nSites });
  return {
    note: `song ${reuploaded ? "re-uploaded" : `chained as output asset ${audioAsset.slice(0, 8)}`} · n_sites ${nSites} ← colony qubits · depth ${params.depth} ← circuit depth · θx ${fx(params.theta_x as number)} ← entropy ${fx(entropy)} bits · feedback ${fx(params.feedback as number)} ← decay ${fx(decay)} → ${fx(wav.durationSec, 1)} s ${wav.channels === 2 ? "stereo" : "mono"} echo`,
  };
}

const STAGE_FNS: Record<StageId, (ctx: Ctx, h: StageHandle) => Promise<StageResult>> = {
  genesis,
  colony,
  morphogenesis,
  decoherence,
  soma,
  membrane,
  voice,
  echo,
};

// ───────────────────────────────────────────────────────────────── orchestration

function finalizeMetrics(ctx: Ctx) {
  const total = Object.values(ctx.s.runs).reduce((a, r) => a + (r && r.status === "done" ? r.latencyMs ?? 0 : 0), 0);
  patchMetrics(ctx, { totalLatencyMs: total });
}

async function runStages(ctx: Ctx, stages: StageId[]): Promise<Specimen> {
  try {
    for (const id of stages) await execStage(ctx, id, (h) => STAGE_FNS[id](ctx, h));
    finalizeMetrics(ctx);
    log(ctx, "ok", `${ctx.s.name} · gen ${ctx.s.generation} complete — ${stages.length} engines, ${((ctx.s.metrics?.totalLatencyMs ?? 0) / 1000).toFixed(1)} s on Atlas`);
    return ctx.s;
  } finally {
    ctx.deps.reporter?.setMode?.("idle", null);
  }
}

function makeCtx(deps: ChainDeps, s: Specimen, controls: Controls, mode: ChainMode, wounds: Wound[], opts: ChainOptions): Ctx {
  return { deps, s, controls, mode, wounds, signal: opts.signal, opts, mem: {} };
}

/** Full chain from genesis. */
export async function growChain(deps: ChainDeps, controls: Controls, opts: ChainOptions = {}): Promise<Specimen> {
  const runs: Specimen["runs"] = {};
  for (const id of STAGE_ORDER) runs[id] = { id, status: "idle", attempt: 0 };
  const s: Specimen = {
    id: "embryo",
    name: "Specimen ····",
    createdAt: new Date().toISOString(),
    generation: 0,
    controls: { ...controls },
    wounds: [],
    metrics: {},
    runs,
  };
  deps.reporter?.setSpecimen?.(structuredClone(s));
  deps.reporter?.setMode?.("growing", "genesis");
  return runStages(makeCtx(deps, s, controls, "growing", [], opts), STAGE_ORDER);
}

/** Root id of a lineage: "7f3a9c-g3" → "7f3a9c". */
export const rootId = (id: string) => id.replace(/-g\d+$/, "");

/**
 * Re-run decoherence → echo re-using genesis/colony/morphogenesis (status "cached").
 * With `withAudio:false`, voice/echo keep the base artifacts and are marked cached too.
 */
export async function evolveChain(
  deps: ChainDeps,
  base: Specimen,
  wounds: Wound[],
  controls: Controls,
  opts: ChainOptions & { withAudio?: boolean } = {},
): Promise<Specimen> {
  if (!base.genome || !base.colony || !base.skin) throw new Error("evolve needs a specimen with genome, colony and skin");
  const withAudio = opts.withAudio ?? true;
  const generation = base.generation + 1;
  const cached: StageId[] = ["genesis", "colony", "morphogenesis", ...(withAudio ? [] : (["voice", "echo"] as StageId[]))];
  const toRun = STAGE_ORDER.filter((id) => !cached.includes(id));
  const runs: Specimen["runs"] = {};
  for (const id of STAGE_ORDER) {
    runs[id] = cached.includes(id) ? { ...(base.runs[id] ?? { id, attempt: 0 }), id, status: "cached" } : { id, status: "idle", attempt: 0 };
  }
  const s: Specimen = {
    ...structuredClone(base),
    id: `${rootId(base.id)}-g${generation}`,
    createdAt: new Date().toISOString(),
    generation,
    controls: { ...controls },
    wounds: [...wounds],
    runs,
  };
  const m = s.metrics ?? {};
  s.metrics = { qubitsUsed: (m.qubitsUsed ?? 0), entropy: m.entropy, meanLuma: m.meanLuma, hueSkew: m.hueSkew };
  deps.reporter?.setSpecimen?.(structuredClone(s));
  deps.reporter?.setMode?.("evolving", toRun[0]);
  const ctx = makeCtx(deps, s, controls, "evolving", wounds, opts);
  // qubit estimate restarts from the cached stages' share
  const n = base.colony.numQubits;
  const px = base.skin.width * base.skin.height;
  ctx.s.metrics = { ...ctx.s.metrics, qubitsUsed: 12 + n + 3 * (Math.ceil(Math.log2(px)) + 1) };
  return runStages(ctx, toRun);
}

/**
 * Continue a halted specimen from its first stage that is not done/cached (Node resume after a flaky engine).
 */
export async function resumeChain(deps: ChainDeps, partial: Specimen, opts: ChainOptions = {}): Promise<Specimen> {
  const firstTodo = STAGE_ORDER.findIndex((id) => {
    const st = partial.runs[id]?.status;
    return st !== "done" && st !== "cached";
  });
  if (firstTodo < 0) return partial;
  const toRun = STAGE_ORDER.slice(firstTodo);
  const s = structuredClone(partial);
  for (const id of toRun) s.runs[id] = { id, status: "idle", attempt: 0 };
  deps.reporter?.setSpecimen?.(structuredClone(s));
  const mode: ChainMode = s.generation > 0 ? "evolving" : "growing";
  deps.reporter?.setMode?.(mode, toRun[0]);
  return runStages(makeCtx(deps, s, s.controls, mode, s.wounds ?? [], opts), toRun);
}
