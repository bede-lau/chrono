/**
 * Chrono — shared data contracts.
 *
 * OWNER: orchestrator. Every agent builds against these types.
 * Rule: you may ADD optional fields; never rename/remove/retype existing ones.
 */

/** The eight lifecycle stages of the organism, in daisy-chain order. */
export type StageId =
  | "genesis" // comet-qrng-v1
  | "colony" // graph-v1
  | "morphogenesis" // tessa-image-v1
  | "decoherence" // blur-v1
  | "soma" // blur-core-v1
  | "membrane" // entanglement-shader-v1
  | "voice" // qrc-audio-v1
  | "echo"; // retrocausal-echo-v1

export interface StageMeta {
  id: StageId;
  index: number; // 0..7
  engineId: string; // Moth engine id
  engineName: string; // Human engine name as shown in Atlas
  title: string; // Lifecycle name shown in UI, e.g. "Genesis"
  consumes: string; // Short: what it takes from the previous stage
  produces: string; // Short: what it hands to the next stage
}

export const STAGES: readonly StageMeta[] = [
  { id: "genesis", index: 0, engineId: "comet-qrng-v1", engineName: "Comet QRNG", title: "Genesis", consumes: "Born-rule measurements", produces: "256-bit genome" },
  { id: "colony", index: 1, engineId: "graph-v1", engineName: "Quantum Graph", title: "Colony", consumes: "Genome seed", produces: "Cell nuclei (Bloch vectors)" },
  { id: "morphogenesis", index: 2, engineId: "tessa-image-v1", engineName: "Tessa Image", title: "Morphogenesis", consumes: "Colony seed image", produces: "Quantum skin" },
  { id: "decoherence", index: 3, engineId: "blur-v1", engineName: "Quantum Blur", title: "Decoherence", consumes: "Skin + wound mask", produces: "Aged tissue" },
  { id: "soma", index: 4, engineId: "blur-core-v1", engineName: "Quantum Blur Core", title: "Soma", consumes: "Tissue density grid", produces: "Entangled displacement field" },
  { id: "membrane", index: 5, engineId: "entanglement-shader-v1", engineName: "Entanglement Shader", title: "Membrane", consumes: "Tissue + soma metrics", produces: "Iridescent BSDF LUTs" },
  { id: "voice", index: 6, engineId: "qrc-audio-v1", engineName: "QRC Audio", title: "Voice", consumes: "Membrane-voiced chunks", produces: "Reservoir-sequenced song" },
  { id: "echo", index: 7, engineId: "retrocausal-echo-v1", engineName: "Retrocausal Echo", title: "Echo", consumes: "Song", produces: "Quantum multi-tap echo" },
] as const;

export type StageStatus =
  | "idle"
  | "queued"
  | "uploading"
  | "running"
  | "retrying"
  | "done"
  | "failed"
  | "cached"; // artifact reused from a previous run (e.g. evolve re-uses genesis..morphogenesis)

export interface StageRun {
  id: StageId;
  status: StageStatus;
  attempt: number; // 1-based; >1 means retried
  jobId?: string; // Moth job id (the proof it ran on Atlas)
  startedAt?: number; // epoch ms
  finishedAt?: number; // epoch ms
  latencyMs?: number; // wall-clock submit->completed
  params?: Record<string, unknown>; // exact params sent to the engine
  inputs?: Record<string, string>; // input slot -> asset id actually sent
  error?: string;
  note?: string; // one-line human explanation of the coupling for this run
}

/** User-facing mutation controls (PRD 4.1 "Mutation Sliders"). */
export interface Controls {
  circuitDepth: number; // 1..12  -> echo depth, graph qubits, shot budget
  entanglement: number; // 0..1   -> blur reach, blur-core reach, shader interaction
  decay: number; // 0..1         -> blur strength, wound fade speed
  machine: "aer" | "fake_fez" | "fake_torino" | "fake_marrakesh"; // Tessa backend (fake_* = real IBM chip noise model)
}

export const DEFAULT_CONTROLS: Controls = { circuitDepth: 8, entanglement: 0.45, decay: 0.5, machine: "aer" };

/** A decoherence event: user clicked the organism at this UV. */
export interface Wound {
  u: number; // 0..1
  v: number; // 0..1 latitude: 1 = NORTH pole = TOP row of every texture/mask image (same as three.js uv.y and the shader's dirToUv)
  strength: number; // 0..1
  t: number; // epoch ms
}

export interface GenomeArtifact {
  hex: string; // 64 hex chars (32 bytes)
  bytes: number[]; // 32 ints 0..255
  source: "qrng" | "qrng-counts"; // "qrng-counts" = extractor yielded < 32 bytes, genome = SHA-256 of raw counts
  minEntropyPerBit?: number;
  commit?: string; // QRNG commitment hash (provenance)
}

export interface BlochVector {
  x: number;
  y: number;
  z: number;
}

export interface ColonyArtifact {
  numQubits: number;
  bloch: BlochVector[]; // per-qubit Bloch vector = one cell nucleus
  correlations: { a: number; b: number; zz: number }[]; // per-edge ZZ expectation
  dominant: string; // dominant bitstring
  seed: ImageArtifact; // 64x64 colony seed PNG rendered from the Bloch vectors (Tessa input)
}

export interface ImageArtifact {
  url: string; // data: URL, blob: URL or /specimens/<id>/<file>
  assetId?: string; // Moth asset id (input or output) — lets the next engine chain without re-upload
  width: number;
  height: number;
}

export interface SomaArtifact {
  size: number; // N (grid is N x N)
  grid: number[]; // N*N row-major, normalised 0..1 (displacement field)
  variance: number;
}

export interface Lut {
  width: number; // phase axis (s), periodic
  height: number; // angle axis (t): row 0 = theta 0, last row = theta pi/2
  data: number[]; // width*height, R channel (float, may exceed 1)
}

export interface MembraneArtifact {
  params: {
    reflectance: number;
    absorption: number;
    layers: number;
    incoming_rays: number;
    interaction: number;
    style: "peaked" | "frustrated" | "3-body" | "constrained";
    resolution: number;
  };
  rLut: Lut; // reflectance LUT (from R_lut.hdr)
  tLut: Lut; // transmittance LUT (from T_lut.hdr)
  glsl?: string; // entanglement_texture.glsl as returned by the engine (shown in inspector)
}

export interface AudioArtifact {
  url: string; // /specimens/<id>/<file>.wav or blob: URL
  assetId?: string;
  durationSec?: number;
}

export interface SpecimenMetrics {
  entropy: number; // Shannon entropy of tissue luminance histogram, bits (0..8)
  meanLuma: number; // 0..1
  hueSkew: number; // -1..1
  displacementVariance: number;
  totalLatencyMs: number;
  qubitsUsed: number; // sum over stages of qubit registers allocated (best estimate)
}

export interface Specimen {
  id: string; // e.g. "7f3a9c" (first 6 hex of genome)
  name: string; // e.g. "Specimen 7F3A"
  createdAt: string; // ISO
  generation: number; // 0 at genesis, +1 per evolve
  controls: Controls;
  wounds: Wound[]; // wounds applied in the latest decoherence pass
  genome?: GenomeArtifact;
  colony?: ColonyArtifact;
  skin?: ImageArtifact; // Tessa output
  tissue?: ImageArtifact; // Blur output
  mask?: ImageArtifact; // wound mask sent to blur-v1 with the skin (added by pipeline agent; optional)
  soma?: SomaArtifact;
  membrane?: MembraneArtifact;
  voice?: AudioArtifact; // QRC Audio output
  echo?: AudioArtifact; // Retrocausal Echo output (what plays)
  metrics?: Partial<SpecimenMetrics>;
  runs: Partial<Record<StageId, StageRun>>;
}

/** public/specimens/index.json */
export interface ArchiveIndex {
  specimens: { id: string; name: string; createdAt: string; generation: number; thumb: string }[];
}

export interface LogLine {
  t: number;
  stage?: StageId;
  level: "info" | "ok" | "warn" | "error";
  msg: string;
}

/**
 * Chrono Lens (round 2): isolates ONE engine's contribution on the living organism so cause and effect are visible.
 * Written by the UI (evolution panel), read by the viewport.
 */
export interface LensState {
  /** Engine whose effect is being showcased on the blob; null = lens off (organism shows everything applied). */
  stage: StageId | null;
  /** 0 = organism WITHOUT this engine's contribution -> 1 = fully WITH it. The viewport eases toward this. */
  amount: number;
  /** Compare: hemisphere wipe across the blob — one side without the engine, the other with it. */
  compare: boolean;
  /** Draw the engine's diagnostic overlay on the surface (wound heat + scars / soma contours + entangled links / membrane angle bands ...). */
  overlay: boolean;
}
export const LENS_OFF: LensState = { stage: null, amount: 1, compare: false, overlay: true };

/**
 * A shared point of interest between the 3D organism and the 2D artifact previews in the panel (linked hover):
 * hover the blob -> crosshair on the artifact previews; hover a preview -> ring on the blob.
 */
export interface Probe {
  u: number; // 0..1 longitude
  v: number; // 0..1 latitude, 1 = north pole (same convention as Wound)
  source: "blob" | "panel"; // who set it
  /** blob-sourced only: incidence angle at that point, 0..PI/2 (LUT row axis) */
  theta?: number;
  /** blob-sourced only: LUT phase coordinate s for R,G,B in [0,1) (LUT column axis) */
  phase?: [number, number, number];
}
