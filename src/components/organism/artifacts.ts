/**
 * Pure helpers that turn chain artifacts into viewport-ready numbers.
 * OWNER: viewport agent.
 *
 * UV conventions (shared with the imaging module and the blur-v1 wound mask):
 *   Wound / image space: u = longitude 0..1, v = 0 at the TOP row (north pole, +Y) .. 1 at the bottom row.
 *   Mesh / texture space: three.js SphereGeometry — uv.y = 1 - v (images are uploaded with flipY).
 *   Direction for (u, v):  phi = 2πu, theta = πv,  d = (-cos φ sin θ, cos θ, sin φ sin θ)  (matches SphereGeometry).
 */
import type { BlochVector, ColonyArtifact, Lut, SomaArtifact } from "@/lib/chain/types";

export const TAU = Math.PI * 2;

export type Vec3 = [number, number, number];

/** Wound/image-space (u, v) -> unit direction on the organism (object space, before stretch). */
export function uvToDir(u: number, v: number): Vec3 {
  const phi = u * TAU;
  const theta = Math.min(Math.max(v, 0), 1) * Math.PI;
  const s = Math.sin(theta);
  return [-Math.cos(phi) * s, Math.cos(theta), Math.sin(phi) * s];
}

/** Unit direction -> wound/image-space (u, v). Inverse of uvToDir. */
export function dirToUv(d: Vec3): { u: number; v: number } {
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  const x = d[0] / len, y = d[1] / len, z = d[2] / len;
  let u = Math.atan2(z, -x) / TAU;
  u = ((u % 1) + 1) % 1;
  const v = Math.acos(Math.min(Math.max(y, -1), 1)) / Math.PI;
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
 * angle θ (from +Z) is the image latitude (v = θ/π, north = |0>), the azimuth φ the longitude (u = (φ + π)/2π).
 * Colour follows Tessa's colour sphere: θ=0 white pole, θ=π black pole, hue = φ, saturation ~ |r|.
 */
export function nucleusFromBloch(b: BlochVector, i: number): Nucleus {
  const r = Math.hypot(b.x, b.y, b.z);
  const theta = r > 1e-6 ? Math.acos(Math.max(-1, Math.min(1, b.z / r))) : Math.PI / 2;
  const phi = Math.atan2(b.y, b.x); // -π..π
  // imaging/colony.ts renders the seed with phi = 2πu − π, v = θ/π  ->  u = (φ + π) / 2π
  const dir = uvToDir((phi + Math.PI) / TAU, theta / Math.PI);
  // Keep nuclei luminous (they glow), but preserve Tessa's hue + saturation semantics.
  const light = 0.42 + 0.3 * (1 - theta / Math.PI);
  const color = srgbToLinear(hslToRgb((phi + TAU) / TAU, 0.35 + 0.6 * Math.min(1, r), light));
  return { dir, color, strength: Math.min(1, r), phase: (i * 2.399) % TAU };
}

export function nucleiFromColony(colony?: ColonyArtifact | null): Nucleus[] {
  if (!colony?.bloch?.length) return [];
  return colony.bloch.slice(0, MAX_NUCLEI).map(nucleusFromBloch);
}

export const MAX_NUCLEI = 12;

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
 * (row 0 -> texture v = 0, south). Bilinear; u wraps, v clamps.
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
 * Soma grid (N x N, row-major, row 0 = top/north) -> SOMA_RES² centred displacement in [-1, 1], rows flipped
 * for a DataTexture sampled with mesh uv. Log compression tames blur-core's heavy-tailed output
 * (one hotspot + faint non-local echoes along its row/column become a lattice of smaller nodules).
 */
export function somaField(soma?: SomaArtifact | null): Float32Array | null {
  if (!soma?.grid?.length) return null;
  const n = soma.size > 0 ? soma.size : Math.round(Math.sqrt(soma.grid.length));
  if (n < 2 || soma.grid.length < n * n) return null;
  const src = soma.grid;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n * n; i++) {
    const v = src[i];
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) return null;
  const span = hi - lo > 1e-9 ? hi - lo : 1;
  const EPS = 0.004;
  const LOGN = Math.log(1 + 1 / EPS);
  const comp = (v: number) => Math.log(1 + Math.max(0, (Number.isFinite(v) ? v : lo) - lo) / span / EPS) / LOGN;
  return centreField(resampleField(src, n, n, comp));
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
