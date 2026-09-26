/**
 * TEMPORARY dev-only mock data so the UI can be built before the pipeline lands.
 * Everything here is deterministic from the specimen id. Removed once the real controller exists.
 */
import { STAGES, DEFAULT_CONTROLS, type Controls, type Specimen, type StageId, type StageRun, type BlochVector, type Lut, type Wound } from "@/lib/chain/types";

export function rng(seedStr: string) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (bytes: number[]) => bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
const uuid = (r: () => number) =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const v = Math.floor(r() * 16);
    return (c === "x" ? v : (v & 0x3) | 0x8).toString(16);
  });

function canvasUrl(size: number, paint: (img: ImageData) => void, scale = 1): string {
  if (typeof document === "undefined") return "";
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  paint(img);
  ctx.putImageData(img, 0, 0);
  if (scale === 1) return c.toDataURL("image/png");
  const big = document.createElement("canvas");
  big.width = size * scale;
  big.height = size * scale;
  const bctx = big.getContext("2d")!;
  bctx.imageSmoothingEnabled = true;
  bctx.filter = "blur(6px)";
  bctx.drawImage(c, 0, 0, big.width, big.height);
  return big.toDataURL("image/png");
}

function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function colonyImage(bloch: BlochVector[], size: number, variant: number, wounds: Wound[] = []): string {
  return canvasUrl(size, (img) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const lon = (x / size) * Math.PI * 2;
        const lat = (y / size - 0.5) * Math.PI;
        const d = { x: Math.cos(lat) * Math.cos(lon), y: Math.cos(lat) * Math.sin(lon), z: Math.sin(lat) };
        let best = -2;
        let second = -2;
        let bi = 0;
        bloch.forEach((b, i) => {
          const n = Math.hypot(b.x, b.y, b.z) || 1;
          const dot = (d.x * b.x + d.y * b.y + d.z * b.z) / n;
          if (dot > best) {
            second = best;
            best = dot;
            bi = i;
          } else if (dot > second) second = dot;
        });
        const b = bloch[bi];
        const hue = ((Math.atan2(b.y, b.x) * 180) / Math.PI + 360 + variant * 23) % 360;
        const edge = Math.min(1, (best - second) * 6);
        let l = 0.28 + 0.34 * edge + 0.12 * b.z;
        let s = 0.55 + 0.3 * edge;
        for (const w of wounds) {
          const du = Math.min(Math.abs(x / size - w.u), 1 - Math.abs(x / size - w.u));
          const dv = y / size - w.v;
          const k = Math.exp(-(du * du + dv * dv) / 0.006) * w.strength;
          l = l * (1 - 0.5 * k) + 0.1 * k;
          s = s * (1 - 0.7 * k);
        }
        if (variant > 1) s *= 0.8;
        const [r, g, bb] = hsl2rgb(hue, s, l);
        const i = (y * size + x) * 4;
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = bb;
        img.data[i + 3] = 255;
      }
    }
  });
}

function makeLut(r: () => number, n: number, phase: number): Lut {
  const data: number[] = [];
  const k = 2 + Math.floor(r() * 4);
  for (let t = 0; t < n; t++)
    for (let s = 0; s < n; s++) {
      const th = (t / n) * (Math.PI / 2);
      const v = 0.5 + 0.5 * Math.sin((s / n) * Math.PI * 2 * k + phase + Math.cos(th) * 3) * Math.cos(th * 1.3);
      data.push(Math.max(0, v * (0.4 + 0.6 * Math.cos(th))));
    }
  return { width: n, height: n, data };
}

function encodeWavBlobUrl(seconds: number, freqs: number[]): string {
  if (typeof window === "undefined") return "";
  const sr = 22050;
  const n = Math.floor(seconds * sr);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  w(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.sin((Math.PI * i) / n) * (0.6 + 0.4 * Math.sin(t * 5.3));
    let s = 0;
    freqs.forEach((f, j) => (s += Math.sin(2 * Math.PI * f * t) / (j + 1)));
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s * env * 0.35)) * 32767, true);
  }
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

const LATENCY: Record<StageId, number> = {
  genesis: 8200,
  colony: 7900,
  morphogenesis: 828000,
  decoherence: 7100,
  soma: 4300,
  membrane: 61200,
  voice: 21400,
  echo: 9800,
};

export function mockArtifacts(id: string, generation: number, controls: Controls, wounds: Wound[] = []) {
  const r = rng(id);
  const bytes = Array.from({ length: 32 }, () => Math.floor(r() * 256));
  const numQubits = 6 + (bytes[4] % 5);
  const bloch: BlochVector[] = Array.from({ length: numQubits }, () => {
    const th = Math.acos(2 * r() - 1);
    const ph = r() * Math.PI * 2;
    const m = 0.35 + 0.65 * r();
    return { x: m * Math.sin(th) * Math.cos(ph), y: m * Math.sin(th) * Math.sin(ph), z: m * Math.cos(th) };
  });
  const correlations = Array.from({ length: numQubits }, (_, a) => ({ a, b: (a + 1) % numQubits, zz: r() * 2 - 1 }));
  const soma = Array.from({ length: 32 * 32 }, (_, i) => {
    const x = i % 32;
    const y = Math.floor(i / 32);
    return 0.5 + 0.5 * Math.sin(x * 0.4 + bytes[1] * 0.1) * Math.cos(y * 0.33 + generation * 0.7) * (0.6 + 0.4 * r());
  });
  const entropy = 4.2 + 2.6 * r() + generation * 0.21;
  const meanLuma = 0.3 + 0.3 * r();
  const style = entropy < 5 ? "peaked" : entropy < 6.5 ? "frustrated" : "constrained";
  return {
    genome: { hex: hex(bytes), bytes, source: "qrng" as const, minEntropyPerBit: 0.93, commit: hex(bytes.slice().reverse()) + hex(bytes) },
    colony: {
      numQubits,
      bloch,
      correlations,
      dominant: bloch.map((b) => (b.z > 0 ? "0" : "1")).join(""),
      seed: { url: colonyImage(bloch, 32, 0), width: 32, height: 32, assetId: uuid(r) },
    },
    skin: { url: colonyImage(bloch, 32, 1), width: 32, height: 32, assetId: uuid(r) },
    tissue: { url: colonyImage(bloch, 32, 2, wounds), width: 32, height: 32, assetId: uuid(r) },
    soma: { size: 32, grid: soma, variance: 0.041 + r() * 0.03 },
    membrane: {
      params: {
        reflectance: +(0.08 + 0.6 * meanLuma).toFixed(3),
        absorption: +Math.min(0.98, entropy / 8).toFixed(3),
        layers: 1 + Math.floor(r() * 4),
        incoming_rays: 6 + (bytes[5] % 4),
        interaction: +(r() * 4 - 2).toFixed(2),
        style: style as "peaked" | "frustrated" | "constrained",
        resolution: 48,
      },
      rLut: makeLut(r, 48, 0),
      tLut: makeLut(r, 48, 1.7),
      glsl: `// entanglement_texture.glsl\nuniform sampler2D R_lut;\nuniform sampler2D T_lut;\nuniform float thickness; // nm\n\nvec3 iridescence(float cosTheta) {\n  float D = -2.0 * 6.2831853 * thickness * cosTheta;\n  vec3 lambda = vec3(650.0, 530.0, 470.0);\n  vec3 s = mod(D / lambda, 6.2831853) / 6.2831853;\n  float t = acos(cosTheta) / 1.5707963;\n  return vec3(\n    texture(R_lut, vec2(s.r, t)).r,\n    texture(R_lut, vec2(s.g, t)).r,\n    texture(R_lut, vec2(s.b, t)).r\n  );\n}\n`,
    },
    voice: { url: encodeWavBlobUrl(2.2, [110 + bytes[8], 165 + bytes[9] / 2, 220]), durationSec: 2.2 },
    echo: { url: encodeWavBlobUrl(2.8, [98 + bytes[10] / 2, 147, 196 + bytes[11] / 3]), durationSec: 2.8 },
    metrics: {
      entropy,
      meanLuma,
      hueSkew: r() * 2 - 1,
      displacementVariance: 0.05,
      totalLatencyMs: Object.values(LATENCY).reduce((a, b) => a + b, 0),
      qubitsUsed: 12 + numQubits + 11 + 21 + 8 + numQubits,
    },
    controls,
  };
}

export function mockRun(id: StageId, seed: string, extra: Partial<StageRun> = {}): StageRun {
  const r = rng(seed + id);
  const idx = STAGES.findIndex((s) => s.id === id);
  const latencyMs = Math.round(LATENCY[id] * (0.85 + 0.3 * r()));
  const notes: Record<StageId, string> = {
    genesis: "12 qubits × 4096 shots → 32 bytes (min-entropy 0.93 bit/bit)",
    colony: `seed 0x${Math.floor(r() * 0xffffffff).toString(16)} ← genome[0..3] · ring + ${2 + Math.floor(r() * 5)} chords`,
    morphogenesis: "colour-sphere encode 32×32 on aer · 1024 shots",
    decoherence: `strength ${(0.25 + 0.6 * 0.5).toFixed(2)} ← decay 0.50 · reach 0.36 ← entanglement 0.45`,
    soma: "strength 0.53 ← entanglement 0.45 · 32×32 luma grid",
    membrane: `absorption ${(0.6 + r() * 0.3).toFixed(2)} ← tissue entropy ${(4.8 + r() * 1.5).toFixed(2)} bits`,
    voice: `variation 1.05 ← entanglement 0.45 · 10 chunks voiced from LUT rows`,
    echo: `theta_x ${(0.3 + r()).toFixed(2)} ← entropy · depth 8 · feedback 0.15`,
  };
  const params: Record<StageId, Record<string, unknown>> = {
    genesis: { num_qubits: 12, shots: 4096, mode: "emu" },
    colony: { seed: Math.floor(r() * 0xffffffff), num_qubits: 8, shots: 1024, mode: "emu", coupling_map: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]] },
    morphogenesis: { machine: "aer", shots: 1024 },
    decoherence: { strength: 0.55, reach: 0.36, style: "rx" },
    soma: { values: Array.from({ length: 32 }, () => Array(32).fill(0)), strength: 0.525, reach: 0.45, style: "xy" },
    membrane: { reflectance: 0.31, absorption: 0.71, layers: 2, incoming_rays: 7, interaction: -0.84, style: "frustrated", resolution: 48 },
    voice: { length: 16, quality: "fast", seed: Math.floor(r() * 0xffffffff), variation: 1.05, crossfade: 120, loop: true },
    echo: { n_sites: 8, depth: 8, theta_x: 1.14, mix: 0.55, feedback: 0.15, machine: "aer", negative_mode: "invert" },
  };
  const finishedAt = Date.now() - (8 - idx) * 60000;
  return {
    id,
    status: "done",
    attempt: id === "morphogenesis" ? 2 : 1,
    jobId: `job_${Math.floor(r() * 1e16).toString(36)}${Math.floor(r() * 1e8).toString(36)}`,
    startedAt: finishedAt - latencyMs,
    finishedAt,
    latencyMs,
    params: params[id],
    inputs: idx === 0 ? {} : { [idx === 3 ? "image" : "input"]: `ast_${Math.floor(r() * 1e12).toString(36)}` },
    note: notes[id],
    ...extra,
  };
}

export function mockSpecimen(id: string, generation = 0, controls: Controls = DEFAULT_CONTROLS): Specimen {
  const a = mockArtifacts(id, generation, controls);
  const runs = Object.fromEntries(STAGES.map((s) => [s.id, mockRun(s.id, id + generation)])) as Specimen["runs"];
  return {
    id,
    name: `Specimen ${id.slice(0, 4).toUpperCase()}`,
    createdAt: new Date(Date.now() - generation * 3600_000).toISOString(),
    generation,
    wounds: [],
    runs,
    ...a,
  };
}

export { LATENCY };
