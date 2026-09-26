/**
 * Colony seed rendering — the organism's first visible form, and Tessa's image input.
 * OWNER: imaging agent. Pure, deterministic, isomorphic.
 */
import type { BlochVector } from "../chain/types";
import type { RGBAImage } from "./index";

type Vec3 = [number, number, number];

interface Nucleus {
  dir: Vec3; // unit direction on the sphere
  color: Vec3; // RGB 0..255
  realIndex: number; // index into the original `bloch` array, or -1 for a genome-driven satellite
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function sphDir(theta: number, phi: number): Vec3 {
  const st = Math.sin(theta);
  return [st * Math.cos(phi), st * Math.sin(phi), Math.cos(theta)];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Bloch vector -> (unit direction, polar angle theta from +Z, azimuth phi, magnitude r). */
function toSpherical(v: BlochVector): { dir: Vec3; theta: number; phi: number; r: number } {
  const r = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  const dir: Vec3 = r > 1e-9 ? [v.x / r, v.y / r, v.z / r] : [0, 0, 1];
  const theta = Math.acos(clamp(dir[2], -1, 1));
  const phi = Math.atan2(dir[1], dir[0]);
  return { dir, theta, phi, r };
}

/**
 * The colour-sphere mapping shared with Tessa's colour-sphere encode/decode:
 * theta=0 (north pole) -> white, theta=pi (south pole) -> black, hue = phi
 * (azimuth), saturation grows with the Bloch vector's purity |r|. Implemented
 * as HSL with L derived from theta (max chroma sits at the equator, L=0.5,
 * which is exactly where HSL saturation reads as "most saturated").
 */
function colorSphere(theta: number, phi: number, r: number): Vec3 {
  const l = 1 - theta / Math.PI;
  // Floor saturation so genome-driven satellite nuclei (which carry a
  // deliberately reduced synthetic |r|) still read as colourful cells rather
  // than washed out — pure grayscale is reserved for the poles via L alone.
  const s = clamp(0.25 + 0.75 * clamp(r, 0, 1), 0, 1);
  const twoPi = Math.PI * 2;
  const h = (((phi % twoPi) + twoPi) % twoPi) / twoPi;
  return hslToRgb(h, s, l);
}

function hueToRgbChannel(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): Vec3 {
  if (s === 0) {
    const v = l * 255;
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hueToRgbChannel(p, q, h + 1 / 3);
  const g = hueToRgbChannel(p, q, h);
  const b = hueToRgbChannel(p, q, h - 1 / 3);
  return [r * 255, g * 255, b * 255];
}

/** Deterministic PRNG (mulberry32) seeded by an FNV-1a hash of the genome bytes. */
function makeRng(genome: number[]): () => number {
  let h = 0x811c9dc5;
  for (const byte of genome) {
    h ^= byte & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  if (genome.length === 0) h = 0x9e3779b9;
  let state = h >>> 0;
  return function mulberry32(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

/**
 * Render the colony seed image (Tessa input) from the graph-v1 Bloch vectors.
 * Equirectangular (u = longitude, v = latitude) so it wraps a sphere-like mesh
 * seamlessly in u (guaranteed for free: pixel direction vectors are built from
 * sin/cos of phi, which are periodic, so u=0 and u=1 map to identical directions).
 */
export function renderColonySeed(
  bloch: BlochVector[],
  correlations: { a: number; b: number; zz: number }[],
  genome: number[],
  size = 32,
): RGBAImage {
  const width = size;
  const height = size;
  const rng = makeRng(genome);

  // Real nuclei: one per measured qubit, coloured/placed straight from its Bloch vector.
  const nuclei: Nucleus[] = bloch.map((v, i) => {
    const { dir, theta, phi, r } = toSpherical(v);
    return { dir, color: colorSphere(theta, phi, r), realIndex: i };
  });

  // Genome-driven satellite nuclei fill the colony out to ~12-24 cells total.
  // Uniform-on-sphere sampling (theta = acos(1-2u)) avoids pole clustering.
  const targetTotal = 12 + Math.floor(rng() * 13); // 12..24
  const extra = Math.max(0, targetTotal - nuclei.length);
  for (let k = 0; k < extra; k++) {
    const theta = Math.acos(1 - 2 * rng());
    const phi = rng() * Math.PI * 2;
    const r = 0.55 + 0.4 * rng(); // slightly less "pure" than a measured nucleus
    nuclei.push({ dir: sphDir(theta, phi), color: colorSphere(theta, phi, r), realIndex: -1 });
  }

  // ZZ correlation lookup for membrane width between two *measured* nuclei;
  // any pair touching a satellite (or missing from the tomography) falls back
  // to the mean |ZZ| across all measured pairs, so membranes stay coherent.
  const zzMap = new Map<string, number>();
  let sumAbsZZ = 0;
  for (const c of correlations) {
    zzMap.set(pairKey(c.a, c.b), c.zz);
    sumAbsZZ += Math.abs(c.zz);
  }
  const meanAbsZZ = correlations.length > 0 ? sumAbsZZ / correlations.length : 0.15;

  function lookupZZ(a: Nucleus, b: Nucleus): number {
    if (a.realIndex < 0 || b.realIndex < 0) return meanAbsZZ;
    return zzMap.get(pairKey(a.realIndex, b.realIndex)) ?? meanAbsZZ;
  }

  const data = new Uint8ClampedArray(width * height * 4);
  const nucleusGlowRadius = 0.32; // radians; how far the "brighter nucleus" glow reaches
  const nucleusGlowAmount = 0.4; // 0..1 lerp toward white at the nucleus centre
  const membraneDarkness = 0.65; // 0..1 fraction darkened right at a cell border

  for (let py = 0; py < height; py++) {
    const v = (py + 0.5) / height;
    const theta = v * Math.PI; // v=0 -> theta=0 (white pole), v=1 -> theta=pi (black pole)
    for (let px = 0; px < width; px++) {
      const u = (px + 0.5) / width;
      const phi = u * Math.PI * 2 - Math.PI;
      const pdir = sphDir(theta, phi);

      // Nearest + second-nearest nucleus by angular distance (Voronoi on the sphere).
      let best = -1;
      let bestDot = -2;
      let second = -1;
      let secondDot = -2;
      for (let ni = 0; ni < nuclei.length; ni++) {
        const d = dot(pdir, nuclei[ni].dir);
        if (d > bestDot) {
          second = best;
          secondDot = bestDot;
          best = ni;
          bestDot = d;
        } else if (d > secondDot) {
          second = ni;
          secondDot = d;
        }
      }

      const nucleus = nuclei[best];
      let [r, g, b] = nucleus.color;

      // Subtle radial gradient: brighter near the nucleus centre.
      const angDist = Math.acos(clamp(bestDot, -1, 1));
      const glow = Math.exp(-angDist / nucleusGlowRadius) * nucleusGlowAmount;
      r = r + (255 - r) * glow;
      g = g + (255 - g) * glow;
      b = b + (255 - b) * glow;

      // Darker membrane near the border with the second-nearest cell; width
      // shrinks as the pair's ZZ correlation grows (entangled cells fuse more,
      // so their shared membrane reads thinner/lighter).
      if (second >= 0) {
        const secondAngDist = Math.acos(clamp(secondDot, -1, 1));
        const borderGap = secondAngDist - angDist;
        const zz = Math.abs(lookupZZ(nucleus, nuclei[second]));
        const membraneWidth = 0.14 - 0.10 * clamp(zz, 0, 1); // 0.14 (weak) .. 0.04 (strong) rad
        if (borderGap < membraneWidth) {
          const t = 1 - borderGap / membraneWidth;
          const darken = 1 - membraneDarkness * t;
          r *= darken;
          g *= darken;
          b *= darken;
        }
      }

      const idx = (py * width + px) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }

  return { width, height, data };
}
