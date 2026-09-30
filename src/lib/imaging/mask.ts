/**
 * Wound mask for blur-v1. Pure, isomorphic (Node + browser, no DOM/Buffer). OWNER: mask agent (round 2).
 *
 * The mask is an equirectangular image (same W x H as the skin it masks) painted on the SPHERE, not on the flat image:
 *
 *  - Convention (see ./sphere.ts, `Wound` in chain/types.ts): u = longitude (wraps), v = latitude with v = 1 the NORTH
 *    pole = TOP image row. Pixel (px, py) is at u = (px + 0.5) / W, v = 1 - (py + 0.5) / H.
 *  - Each wound is a Gaussian in GREAT-CIRCLE distance (radians), so on the blob it is a round scar everywhere: the same
 *    width along longitude and latitude, equator to pole, across the u seam. On the flat image it is the stretched
 *    oval an equirectangular map should show (twice as tall as wide in pixels on a square map, a band at the poles).
 *  - Value of one wound = strength * exp(-a^2 / (2 sigma^2)), sigma = 0.22 + 0.16 * strength radians (12.6 .. 21.8 deg),
 *    never below 1.5 texels of latitude so the smallest wound survives a small mask.
 *  - Organic edge: a per-wound, deterministic smooth noise (seeded from the wound's u, v; no Math.random) modulates sigma
 *    by up to +-15 % and warps the sample direction a little, so scars are not perfect discs. The centre is exact.
 *  - Wounds combine as a soft union 1 - prod(1 - g): overlapping touches deepen the scar but the value never exceeds 1
 *    and the map never flattens to solid white. `baseline` joins the same union, so the floor is exactly `baseline`
 *    and the centre of a strength-1 wound reaches 1.
 *  - 2 x 2 supersampling per pixel (the box-filtered field) removes stair-stepping on the tiny 21-32 px masks.
 *
 * Output is opaque greyscale RGBA (blur-v1 reads the luminance). White = fully decohered.
 */
import type { Wound } from "../chain/types";
import type { RGBAImage } from "./index";
import { uvToDir } from "./sphere";

/** Wound footprint (Gaussian sigma, radians): strength 0 -> 0.22 (12.6 deg), strength 1 -> 0.38 (21.8 deg). */
export const WOUND_SIGMA_MIN = 0.22;
export const WOUND_SIGMA_GAIN = 0.16;
/** Maximum relative jitter of sigma from the organic edge (+-15 %). */
export const WOUND_EDGE_JITTER = 0.15;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Gaussian sigma (radians) of a wound on the sphere. Pass the mask `height` to also apply the anti-aliasing floor of
 * 1.5 texel arcs of latitude (pi / height each), which only bites on masks smaller than ~21 px.
 */
export function woundSigma(strength: number, height?: number): number {
  const s = clamp(Number.isFinite(strength) ? strength : 0, 0, 1);
  const sigma = WOUND_SIGMA_MIN + WOUND_SIGMA_GAIN * s;
  return height && height > 0 ? Math.max(sigma, (1.5 * Math.PI) / height) : sigma;
}

export interface WoundMaskOptions {
  /** Organic edge amount: 0 = perfect great-circle Gaussians, 1 = default (+-15 % sigma jitter and a small warp). */
  organic?: number;
  /** Supersamples per pixel axis (default 2, i.e. 2 x 2). */
  samples?: number;
}

// ───────────────────────────────────────────────────────────────── deterministic noise

/** 32-bit integer avalanche hash of two integers. */
function hash2(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/** mulberry32 PRNG -> uniform [0, 1). */
function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WAVES = 4;

/**
 * A smooth scalar + vector noise field over the sphere for one wound: a few random plane waves in 3D direction space,
 * sin(f * (p . axis) + phase). Being a function of the unit vector p (not of u, v) it has no seam and no pole
 * singularity. Each output component is a weighted sum of the waves with sum |weight| = 1, so it stays within [-1, 1].
 */
interface WoundNoise {
  axis: Float64Array; // 3 * WAVES
  freq: Float64Array;
  phase: Float64Array;
  /** Weights, 4 * WAVES: [scalar, warp x, warp y, warp z] per wave. */
  w: Float64Array;
}

function makeNoise(u: number, v: number): WoundNoise {
  const r = rng(hash2(Math.round(u * 1e5), Math.round(v * 1e5)));
  const n: WoundNoise = {
    axis: new Float64Array(3 * WAVES),
    freq: new Float64Array(WAVES),
    phase: new Float64Array(WAVES),
    w: new Float64Array(4 * WAVES),
  };
  for (let k = 0; k < WAVES; k++) {
    const z = 2 * r() - 1;
    const t = 2 * Math.PI * r();
    const rho = Math.sqrt(Math.max(0, 1 - z * z));
    n.axis[3 * k] = rho * Math.cos(t);
    n.axis[3 * k + 1] = z;
    n.axis[3 * k + 2] = rho * Math.sin(t);
    n.freq[k] = 4 + 5 * r(); // 4..9 rad of phase per unit of projection: a few gentle lobes around a wound
    n.phase[k] = 2 * Math.PI * r();
    for (let c = 0; c < 4; c++) n.w[4 * k + c] = 2 * r() - 1;
  }
  for (let c = 0; c < 4; c++) {
    let sum = 0;
    for (let k = 0; k < WAVES; k++) sum += Math.abs(n.w[4 * k + c]);
    const inv = sum > 1e-9 ? 1 / sum : 0;
    for (let k = 0; k < WAVES; k++) n.w[4 * k + c] *= inv;
  }
  return n;
}

/** Evaluate the noise at unit vector (x, y, z); writes [scalar, warp x, warp y, warp z] into `out`. */
function evalNoise(n: WoundNoise, x: number, y: number, z: number, out: Float64Array): void {
  let s = 0;
  let wx = 0;
  let wy = 0;
  let wz = 0;
  for (let k = 0; k < WAVES; k++) {
    const sn = Math.sin(n.freq[k] * (x * n.axis[3 * k] + y * n.axis[3 * k + 1] + z * n.axis[3 * k + 2]) + n.phase[k]);
    s += n.w[4 * k] * sn;
    wx += n.w[4 * k + 1] * sn;
    wy += n.w[4 * k + 2] * sn;
    wz += n.w[4 * k + 3] * sn;
  }
  out[0] = s;
  out[1] = wx;
  out[2] = wy;
  out[3] = wz;
}

// ───────────────────────────────────────────────────────────────── renderer

interface Kernel {
  cx: number;
  cy: number;
  cz: number;
  strength: number;
  sigma: number;
  noise: WoundNoise;
  /** Noise at the wound centre, subtracted from the warp so the peak sits exactly at (u, v). */
  c0: Float64Array;
}

/** Direction warp in radians per unit of noise, as a fraction of sigma. */
const WARP = 0.1;
/** Wounds beyond this many sigmas contribute < 1e-5 and are skipped. */
const CUTOFF_SIGMAS = 5.5;

/**
 * Wound mask for blur-v1 (same WxH as the image it masks). White = full decoherence. See the file header.
 * `baseline` (0..1) is the floor everywhere so the whole organism ages a little; keep it > 0 (Atlas can reject a blank
 * upload) and above blur-v1's `mask_bin_size` background threshold (~10/255) so the whole map is one blur region.
 * The optional `opts` only exist for tests and previews; production callers pass the first four arguments.
 */
export function renderWoundMask(wounds: Wound[], width: number, height: number, baseline = 0, opts: WoundMaskOptions = {}): RGBAImage {
  const W = Math.max(1, Math.floor(width));
  const H = Math.max(1, Math.floor(height));
  const data = new Uint8ClampedArray(W * H * 4);
  const base = clamp(Number.isFinite(baseline) ? baseline : 0, 0, 1);
  const organic = clamp(opts.organic ?? 1, 0, 1);
  const ss = Math.max(1, Math.floor(opts.samples ?? 2));

  // per-wound kernels
  const kernels: Kernel[] = [];
  for (const w of wounds) {
    if (!w || !Number.isFinite(w.u) || !Number.isFinite(w.v)) continue;
    const strength = clamp(Number.isFinite(w.strength) ? w.strength : 0, 0, 1);
    if (strength <= 0) continue;
    const [cx, cy, cz] = uvToDir(w.u, w.v);
    const noise = makeNoise(w.u, w.v);
    const c0 = new Float64Array(4);
    evalNoise(noise, cx, cy, cz, c0);
    kernels.push({ cx, cy, cz, strength, sigma: woundSigma(strength, H), noise, c0 });
  }

  // trig tables for the subsample grid: phi = 2 pi u along columns, theta = pi (1 - v) = pi (py + .5) / H down rows
  const nx = W * ss;
  const ny = H * ss;
  const cosPhi = new Float64Array(nx);
  const sinPhi = new Float64Array(nx);
  for (let i = 0; i < nx; i++) {
    const phi = (2 * Math.PI * (i + 0.5)) / nx;
    cosPhi[i] = Math.cos(phi);
    sinPhi[i] = Math.sin(phi);
  }
  const cosTheta = new Float64Array(ny);
  const sinTheta = new Float64Array(ny);
  for (let j = 0; j < ny; j++) {
    const theta = (Math.PI * (j + 0.5)) / ny;
    cosTheta[j] = Math.cos(theta);
    sinTheta[j] = Math.sin(theta);
  }

  const jitter = WOUND_EDGE_JITTER * organic;
  const noise = new Float64Array(4);
  const inv = 1 / (ss * ss);

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      let acc = 0;
      for (let sy = 0; sy < ss; sy++) {
        const st = sinTheta[py * ss + sy];
        const y = cosTheta[py * ss + sy];
        for (let sx = 0; sx < ss; sx++) {
          const x = -st * cosPhi[px * ss + sx];
          const z = st * sinPhi[px * ss + sx];

          let rest = 1 - base; // running product of (1 - g); the baseline is the first term of the soft union
          for (const k of kernels) {
            // cheap reject on the raw (un-warped) angle
            const a0 = Math.acos(clamp(x * k.cx + y * k.cy + z * k.cz, -1, 1));
            if (a0 > CUTOFF_SIGMAS * k.sigma) continue;

            let qx = x;
            let qy = y;
            let qz = z;
            let sigma = k.sigma;
            if (organic > 0) {
              evalNoise(k.noise, x, y, z, noise);
              sigma = k.sigma * (1 + jitter * noise[0]);
              const amp = WARP * organic * k.sigma;
              qx = x + amp * (noise[1] - k.c0[1]);
              qy = y + amp * (noise[2] - k.c0[2]);
              qz = z + amp * (noise[3] - k.c0[3]);
              const len = Math.hypot(qx, qy, qz) || 1;
              qx /= len;
              qy /= len;
              qz /= len;
            }
            // great-circle angle to the wound centre: atan2(|q x c|, q . c), stable near 0 and pi
            const crx = qy * k.cz - qz * k.cy;
            const cry = qz * k.cx - qx * k.cz;
            const crz = qx * k.cy - qy * k.cx;
            const a = Math.atan2(Math.hypot(crx, cry, crz), qx * k.cx + qy * k.cy + qz * k.cz);
            rest *= 1 - k.strength * Math.exp(-(a * a) / (2 * sigma * sigma));
          }
          acc += 1 - rest;
        }
      }
      const byte = Math.round(clamp(acc * inv, 0, 1) * 255);
      const idx = (py * W + px) * 4;
      data[idx] = byte;
      data[idx + 1] = byte;
      data[idx + 2] = byte;
      data[idx + 3] = 255;
    }
  }

  return { width: W, height: H, data };
}
