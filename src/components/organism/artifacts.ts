/**
 * Pure helpers that turn chain artifacts into viewport-ready numbers.
 * OWNER: viewport agent.
 *
 * UV conventions (shared contract, see `Wound` in src/lib/chain/types.ts):
 *   Wound / probe / image space: u = longitude 0..1, v = latitude 0..1 with v = 1 at the NORTH pole (+Y) = TOP image
 *   row (row = (1 - v) * height). Same as three.js SphereGeometry uv.y and the shader's dirToUv.
 *   Direction for (u, v):  phi = 2πu, polar = (1 - v)π,  d = (-cos φ sin p, cos p, sin φ sin p)  (matches SphereGeometry).
 */
import type { BlochVector, ColonyArtifact, Lut, SomaArtifact, Wound } from "@/lib/chain/types";

export const TAU = Math.PI * 2;

export type Vec3 = [number, number, number];

/** (u, v) with v = 1 north -> unit direction on the organism (object space, before stretch). */
export function uvToDir(u: number, v: number): Vec3 {
  const phi = u * TAU;
  const polar = (1 - Math.min(Math.max(v, 0), 1)) * Math.PI;
  const s = Math.sin(polar);
  return [-Math.cos(phi) * s, Math.cos(polar), Math.sin(phi) * s];
}

/** Unit direction -> (u, v) with v = 1 north. Inverse of uvToDir (identical to the shader's dirToUv). */
export function dirToUv(d: Vec3): { u: number; v: number } {
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  const x = d[0] / len, y = d[1] / len, z = d[2] / len;
  let u = Math.atan2(z, -x) / TAU;
  u = ((u % 1) + 1) % 1;
  const v = 1 - Math.acos(Math.min(Math.max(y, -1), 1)) / Math.PI;
  return { u, v };
}

/* ------------------------------------------------------------------ genome */

export interface Morphology {
  /** Noise domain offset (genome-seeded). */
  seed: Vec3;
  /** Ellipsoidal stretch (volume-normalised). */
  stretch: Vec3;
  /** 5 gaussian lobes: xyz = direction, w = amplitude. */
  lobes: [number, number, number, number][];
  /** Lobe sharpness (exp falloff). */
  sharp: number[];
  /** Noise-lobe amplitude multiplier. */
  formAmp: number;
}

export const LOBES = 5;

/** A calm default embryo form used before a genome exists. */
const DEFAULT_BYTES = [
  0x7f, 0x3a, 0x9c, 0x51, 0x88, 0x6e, 0x21, 0xc4, 0x5d, 0x90, 0x33, 0xaa, 0x17, 0x62, 0xe9, 0x48,
  0x0b, 0xd3, 0x76, 0x3f, 0xb2, 0x95, 0x4c, 0x2e, 0xf1, 0x68, 0x87, 0x19, 0xc0, 0x5a, 0x24, 0xde,
];

export function morphologyFromGenome(bytes?: number[] | null): Morphology {
  const b = bytes && bytes.length >= 8 ? bytes : DEFAULT_BYTES;
  const byte = (i: number) => (b[i % b.length] ?? 0) / 255;
  const seed: Vec3 = [byte(0) * 40 - 20, byte(1) * 40 - 20, byte(2) * 40 - 20];
  const sx = 0.93 + 0.14 * byte(3);
  const sy = 0.9 + 0.22 * byte(4);
  const sz = 0.93 + 0.14 * byte(5);
  const norm = Math.cbrt(sx * sy * sz);
  const stretch: Vec3 = [sx / norm, sy / norm, sz / norm];
  const lobes: [number, number, number, number][] = [];
  const sharp: number[] = [];
  for (let i = 0; i < LOBES; i++) {
    const o = 6 + i * 4;
    const ct = 2 * byte(o) - 1;
    const st = Math.sqrt(Math.max(0, 1 - ct * ct));
    const ph = TAU * byte(o + 1);
    const amp = (byte(o + 2) - 0.38) * 0.17;
    lobes.push([st * Math.cos(ph), ct, st * Math.sin(ph), amp]);
    sharp.push(2.2 + 6 * byte(o + 3));
  }
  const formAmp = 0.75 + 0.5 * byte(30);
  return { seed, stretch, lobes, sharp, formAmp };
}

/** 256 genome bits (MSB first) as 0/1 floats; null when there is no genome. */
export function genomeBits(bytes?: number[] | null): Float32Array | null {
  if (!bytes || bytes.length < 1) return null;
  const out = new Float32Array(256);
  for (let i = 0; i < 256; i++) out[i] = ((bytes[i >> 3] ?? 0) >> (7 - (i & 7))) & 1;
  return out;
}

/** n evenly spread unit directions (spherical Fibonacci), north -> south. */
export function fibonacciDirs(n: number): Float32Array {
  const out = new Float32Array(n * 3);
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = i * ga;
    out[i * 3] = Math.cos(a) * r;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = Math.sin(a) * r;
  }
  return out;
}

/* ------------------------------------------------------------------ colony */

export interface Nucleus {
  dir: Vec3; // mesh direction
  color: Vec3; // linear-ish RGB 0..1
  strength: number; // |r| of the Bloch vector 0..1
  phase: number; // pulse phase
}

/** HSL (0..1) -> RGB (0..1, sRGB-ish). */
export function hslToRgb(h: number, s: number, l: number): Vec3 {
  const hue = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + hue * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/** sRGB (0..1) -> linear. */
export function srgbToLinear(c: Vec3): Vec3 {
  return c.map((x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))) as Vec3;
}

/**
 * Bloch vector -> nucleus. Placement follows the colony-seed convention (src/lib/imaging/colony.ts): the Bloch polar
 * angle θ (from +Z) is the image row (θ = 0 = top row = north, |0>), the azimuth φ the longitude (u = (φ + π)/2π).
 * Colour follows Tessa's colour sphere: θ=0 white pole, θ=π black pole, hue = φ, saturation ~ |r|.
 */
export function nucleusFromBloch(b: BlochVector, i: number): Nucleus {
  const r = Math.hypot(b.x, b.y, b.z);
  const theta = r > 1e-6 ? Math.acos(Math.max(-1, Math.min(1, b.z / r))) : Math.PI / 2;
  const phi = Math.atan2(b.y, b.x); // -π..π
  // imaging/colony.ts: row fraction = θ/π (top = north)  ->  v = 1 - θ/π ; u = (φ + π) / 2π
  const dir = uvToDir((phi + Math.PI) / TAU, 1 - theta / Math.PI);
  // Keep nuclei luminous (they glow), but preserve Tessa's hue + saturation semantics.
  const light = 0.42 + 0.3 * (1 - theta / Math.PI);
  const color = srgbToLinear(hslToRgb((phi + TAU) / TAU, 0.35 + 0.6 * Math.min(1, r), light));
  return { dir, color, strength: Math.min(1, r), phase: (i * 2.399) % TAU };
}

export const MAX_NUCLEI = 12;

export function nucleiFromColony(colony?: ColonyArtifact | null): Nucleus[] {
  if (!colony?.bloch?.length) return [];
  return colony.bloch.slice(0, MAX_NUCLEI).map(nucleusFromBloch);
}

/** Stable key for a colony (changes only when the nuclei do). */
export function colonyKey(colony?: ColonyArtifact | null): string | null {
  if (!colony?.bloch?.length) return null;
  return `${colony.numQubits}:${colony.bloch.map((b) => `${b.x.toFixed(3)},${b.y.toFixed(3)},${b.z.toFixed(3)}`).join("|")}`;
}

/** Specimen hue (0..1) from the dominant nucleus (largest |r|). */
export function specimenHue(colony?: ColonyArtifact | null): number | null {
  if (!colony?.bloch?.length) return null;
  let best = colony.bloch[0];
  let bestR = -1;
  for (const b of colony.bloch) {
    const r = Math.hypot(b.x, b.y, b.z);
    if (r > bestR) {
      bestR = r;
      best = b;
    }
  }
  let phi = Math.atan2(best.y, best.x);
  if (phi < 0) phi += TAU;
  return phi / TAU;
}

/* -------------------------------------------------------------------- soma */

export const SOMA_RES = 32;

/**
 * Resample a W x H row-major grid (row 0 = top/north) to SOMA_RES² with rows flipped for a DataTexture
 * (texture row 0 = v 0 = south). Bilinear; u wraps, v clamps.
 */
function resampleField(src: ArrayLike<number>, w: number, h: number, map: (v: number) => number): Float32Array {
  const R = SOMA_RES;
  const out = new Float32Array(R * R);
  for (let y = 0; y < R; y++) {
    const fy = ((R - 1 - y + 0.5) / R) * h - 0.5;
    const y0 = Math.max(0, Math.min(h - 1, Math.floor(fy)));
    const y1 = Math.max(0, Math.min(h - 1, y0 + 1));
    const ty = Math.max(0, Math.min(1, fy - Math.floor(fy)));
    for (let x = 0; x < R; x++) {
      const fx = ((x + 0.5) / R) * w - 0.5;
      const xf = Math.floor(fx);
      const tx = fx - xf;
      const x0 = ((xf % w) + w) % w;
      const x1 = (x0 + 1) % w;
      const a = map(src[y0 * w + x0]) * (1 - tx) + map(src[y0 * w + x1]) * tx;
      const b = map(src[y1 * w + x0]) * (1 - tx) + map(src[y1 * w + x1]) * tx;
      out[y * R + x] = a * (1 - ty) + b * ty;
    }
  }
  return out;
}

/** Centre on the mean and scale to max |x| = 1. */
function centreField(out: Float32Array): Float32Array {
  let mean = 0;
  for (let i = 0; i < out.length; i++) mean += out[i];
  mean /= out.length;
  let m = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] -= mean;
    m = Math.max(m, Math.abs(out[i]));
  }
  if (m > 1e-6) for (let i = 0; i < out.length; i++) out[i] /= m;
  return out;
}

/**
 * Standardise by the field's own spread (area-weighted: equirect rows shrink towards the poles) and soft-clip with
 * tanh. Every specimen then warps by a perceptually similar amount, whatever the absolute range blur-core returned.
 */
function standardiseField(out: Float32Array, soft = 1.7): Float32Array {
  const R = SOMA_RES;
  let wsum = 0, mean = 0;
  for (let y = 0; y < R; y++) {
    const w = Math.sin(((y + 0.5) / R) * Math.PI);
    for (let x = 0; x < R; x++) {
      mean += w * out[y * R + x];
      wsum += w;
    }
  }
  mean /= wsum;
  let varc = 0;
  for (let y = 0; y < R; y++) {
    const w = Math.sin(((y + 0.5) / R) * Math.PI);
    for (let x = 0; x < R; x++) varc += w * (out[y * R + x] - mean) ** 2;
  }
  const sd = Math.sqrt(varc / wsum);
  if (!(sd > 1e-9)) {
    out.fill(0);
    return out;
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh((out[i] - mean) / (soft * sd));
  return out;
}

/** Mean of the northmost / southmost texture rows (poles are single points: fade to these). */
export function poleMeans(field: Float32Array): [number, number] {
  const R = SOMA_RES;
  let n = 0, s = 0;
  for (let x = 0; x < R; x++) {
    n += field[(R - 1) * R + x];
    s += field[x];
  }
  return [n / R, s / R];
}

/**
 * Soma grid (N x N, row-major, row 0 = top/north) -> SOMA_RES² displacement field in (-1, 1), rows flipped for a
 * DataTexture sampled with mesh uv. Heavy-tailed outputs (one hotspot + faint non-local echoes, as blur-core returns
 * for sparse inputs) are log-compressed first so the echoes survive; ordinary blurred tissue grids stay linear.
 * The result is standardised (σ-normalised, tanh soft-clipped): amplitude is consistent between specimens.
 */
export function somaField(soma?: SomaArtifact | null): Float32Array | null {
  if (!soma?.grid?.length) return null;
  const n = soma.size > 0 ? soma.size : Math.round(Math.sqrt(soma.grid.length));
  if (n < 2 || soma.grid.length < n * n) return null;
  const src = soma.grid;
  const vals: number[] = [];
  for (let i = 0; i < n * n; i++) if (Number.isFinite(src[i])) vals.push(src[i]);
  if (vals.length < 4) return null;
  vals.sort((a, b) => a - b);
  const q = (p: number) => vals[Math.min(vals.length - 1, Math.max(0, Math.round(p * (vals.length - 1))))];
  const lo = vals[0];
  const hi = vals[vals.length - 1];
  const span = hi - lo > 1e-12 ? hi - lo : 1;
  const heavy = (hi - q(0.5)) / Math.max(q(0.9) - q(0.1), 1e-12) > 4.5;
  const EPS = 0.004;
  const LOGN = Math.log(1 + 1 / EPS);
  const map = heavy
    ? (v: number) => Math.log(1 + Math.max(0, (Number.isFinite(v) ? v : lo) - lo) / span / EPS) / LOGN
    : (v: number) => ((Number.isFinite(v) ? v : lo) - lo) / span;
  return standardiseField(resampleField(src, n, n, map));
}

export interface SomaPeak {
  dir: Vec3;
  /** Displacement-field value at the bump, 0..~2 (field - e·antipode). */
  value: number;
}

/**
 * The strongest bumps of the entangled displacement `f(d) - e·f(-d)` (the body the viewer sees): each one sits
 * opposite a dent. Greedy non-maximum suppression keeps them apart; the poles are skipped (the field fades there).
 * Input: SOMA_RES² texture-layout field (row 0 = south).
 */
export function somaPeaks(field: Float32Array, entangle: number, count = 6, minSep = 0.55): SomaPeak[] {
  const R = SOMA_RES;
  const total = new Float32Array(R * R);
  for (let y = 0; y < R; y++)
    for (let x = 0; x < R; x++) {
      const ax = (x + R / 2) % R;
      const ay = R - 1 - y;
      total[y * R + x] = field[y * R + x] - entangle * field[ay * R + ax];
    }
  const cands: { i: number; v: number }[] = [];
  for (let y = 3; y < R - 3; y++)
    for (let x = 0; x < R; x++) {
      const v = total[y * R + x];
      let isMax = v > 0.05;
      for (let dy = -1; dy <= 1 && isMax; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          if (total[(y + dy) * R + ((x + dx + R) % R)] > v) {
            isMax = false;
            break;
          }
        }
      if (isMax) cands.push({ i: y * R + x, v });
    }
  cands.sort((a, b) => b.v - a.v);
  const out: SomaPeak[] = [];
  const top = cands[0]?.v ?? 0;
  for (const c of cands) {
    if (out.length >= count || c.v < top * 0.2) break;
    const x = c.i % R;
    const y = (c.i - x) / R;
    const dir = uvToDir((x + 0.5) / R, (y + 0.5) / R);
    if (out.some((p) => Math.acos(Math.max(-1, Math.min(1, p.dir[0] * dir[0] + p.dir[1] * dir[1] + p.dir[2] * dir[2]))) < minSep)) continue;
    out.push({ dir, value: c.v });
  }
  return out;
}

/**
 * Colony relief: the colony seed is a spherical Voronoi of the graph-v1 nuclei with darkened membranes.
 * Turn it into a macro-cell height field (cells dome outward, membranes form grooves) so the organism's lobes
 * line up exactly with the coloured cells. Input: RGBA8 pixels, W x H, row 0 = top.
 */
export function colonyRelief(rgba: ArrayLike<number>, w: number, h: number): Float32Array {
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = (0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]) / 255;
  const blur = (a: Float32Array) => {
    const o = new Float32Array(a.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            s += a[yy * w + ((x + dx + w) % w)];
            n++;
          }
        }
        o[y * w + x] = s / n;
      }
    return o;
  };
  // membranes: pixels darker than their neighbourhood
  const Lb = blur(L);
  const mem = new Float32Array(w * h);
  let mx = 0;
  for (let i = 0; i < w * h; i++) {
    mem[i] = Math.max(0, Lb[i] - L[i]) / (Lb[i] + 0.05);
    mx = Math.max(mx, mem[i]);
  }
  let cell = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) cell[i] = 1 - Math.min(1, mem[i] / (mx * 0.45 + 1e-6));
  // rounded domes: repeated blur approximates distance-to-membrane
  cell = blur(blur(cell));
  return centreField(resampleField(cell, w, h, (v) => v));
}

/* -------------------------------------------------------------------- mask */

export interface MaskInfo {
  /** Baseline level (whole-body aging), 0..1. */
  lo: number;
  /** Peak level, 0..1. */
  hi: number;
  /** Wound centres actually present in the mask (v = 1 north). */
  scars: { u: number; v: number; strength: number }[];
}

/**
 * Analyse the wound mask sent to blur-v1 (RGBA8, row 0 = top = north). Wound centres come from the specimen's wounds
 * when the mask confirms them (either latitude convention: archives painted before the v-flip fix stay aligned),
 * otherwise from the mask's own local maxima.
 */
export function analyseMask(rgba: ArrayLike<number>, w: number, h: number, wounds: Wound[] = []): MaskInfo {
  const n = w * h;
  const val = new Float32Array(n);
  for (let i = 0; i < n; i++) val[i] = rgba[i * 4] / 255;
  const sorted = Array.from(val).sort((a, b) => a - b);
  const lo = sorted[Math.floor(0.2 * (n - 1))] ?? 0;
  const hi = sorted[n - 1] ?? 0;
  const scars: MaskInfo["scars"] = [];
  if (hi - lo < 0.06) return { lo, hi, scars };
  const at = (u: number, v: number) => {
    const fx = (((u % 1) + 1) % 1) * w - 0.5;
    const fy = (1 - Math.min(1, Math.max(0, v))) * h - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const px = (x: number, y: number) => val[Math.min(h - 1, Math.max(0, y)) * w + (((x % w) + w) % w)];
    return (px(x0, y0) * (1 - tx) + px(x0 + 1, y0) * tx) * (1 - ty) + (px(x0, y0 + 1) * (1 - tx) + px(x0 + 1, y0 + 1) * tx) * ty;
  };
  const thr = lo + 0.5 * (hi - lo);
  for (const wd of wounds) {
    if (at(wd.u, wd.v) >= thr) scars.push({ u: wd.u, v: wd.v, strength: wd.strength });
    else if (at(wd.u, 1 - wd.v) >= thr) scars.push({ u: wd.u, v: 1 - wd.v, strength: wd.strength });
  }
  if (!scars.length) {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v0 = val[y * w + x];
        if (v0 < thr) continue;
        let isMax = true;
        let sx = 0, sy = 0, sw = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy;
            if (yy < 0 || yy >= h) continue;
            const vv = val[yy * w + ((x + dx + w) % w)];
            if ((dx || dy) && vv > v0) isMax = false;
            const k = Math.max(0, vv - lo);
            sx += k * dx;
            sy += k * dy;
            sw += k;
          }
        if (!isMax) continue;
        const cx = x + 0.5 + (sw > 0 ? sx / sw : 0);
        const cy = y + 0.5 + (sw > 0 ? sy / sw : 0);
        scars.push({ u: cx / w, v: 1 - cy / h, strength: (v0 - lo) / (hi - lo) });
      }
  }
  return { lo, hi, scars };
}

/* --------------------------------------------------------------------- LUT */

export interface LutStats {
  max: number;
  mean: number;
}

export function lutStats(l: Lut): LutStats {
  let max = 0, sum = 0, n = 0;
  for (const v of l.data) {
    if (!Number.isFinite(v)) continue;
    if (v > max) max = v;
    sum += v;
    n++;
  }
  return { max, mean: n ? sum / n : 0 };
}

export function lutValid(l?: Lut | null): l is Lut {
  return !!l && l.width > 1 && l.height > 1 && Array.isArray(l.data) && l.data.length >= l.width * l.height;
}
