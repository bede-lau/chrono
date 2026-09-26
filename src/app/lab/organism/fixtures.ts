/**
 * Lab-only specimen fixtures: procedural data (in-browser) or the spike outputs of the real engines.
 * OWNER: viewport agent.
 */
import { DEFAULT_CONTROLS, type BlochVector, type Lut, type SomaArtifact, type Specimen } from "@/lib/chain/types";
import {
  FIXTURE_BLOCH,
  FIXTURE_CORRELATIONS,
  FIXTURE_DOMINANT,
  FIXTURE_R_LUT,
  FIXTURE_SEED_PNG,
  FIXTURE_SOMA,
  FIXTURE_T_LUT,
  FIXTURE_TESSA_PNG,
} from "./fixture-data";

export const LAB_STAGES = ["∅", "Genesis", "Colony", "Skin", "Tissue", "Soma", "Membrane", "Voice"] as const;

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Return the specimen as it looked after `stage` lab stages (0 = null ... 7 = complete). */
export function specimenAtStage(full: Specimen, stage: number): Specimen | null {
  if (stage <= 0) return null;
  return {
    ...full,
    genome: full.genome,
    colony: stage >= 2 ? full.colony : undefined,
    skin: stage >= 3 ? full.skin : undefined,
    tissue: stage >= 4 ? full.tissue : undefined,
    soma: stage >= 5 ? full.soma : undefined,
    membrane: stage >= 6 ? full.membrane : undefined,
    voice: stage >= 7 ? full.voice : undefined,
    echo: stage >= 7 ? full.echo : undefined,
  };
}

/* ----------------------------------------------------------- image helpers */

type RGBA = { w: number; h: number; data: Uint8ClampedArray };

function toDataUrl(img: RGBA): string {
  const c = document.createElement("canvas");
  c.width = img.w;
  c.height = img.h;
  const ctx = c.getContext("2d")!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
  return c.toDataURL("image/png");
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + hue * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/** Same convention as src/lib/imaging/colony.ts: v = θ/π (top = north), φ = 2πu − π. */
function pixelDir(u: number, v: number): [number, number, number] {
  const theta = v * Math.PI;
  const phi = u * Math.PI * 2 - Math.PI;
  return [Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta)];
}

function colonySeedImage(bloch: BlochVector[], size = 32): RGBA {
  const nuclei = bloch.map((b) => {
    const r = Math.hypot(b.x, b.y, b.z) || 1;
    const theta = Math.acos(Math.max(-1, Math.min(1, b.z / r)));
    const phi = Math.atan2(b.y, b.x);
    const col = hsl((phi + Math.PI * 2) / (Math.PI * 2), 0.3 + 0.65 * Math.min(1, r), 0.12 + 0.76 * (1 - theta / Math.PI));
    return { dir: [b.x / r, b.y / r, b.z / r], col };
  });
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = pixelDir((x + 0.5) / size, (y + 0.5) / size);
      let b1 = -2, b2 = -2, i1 = 0;
      nuclei.forEach((n, i) => {
        const k = d[0] * n.dir[0] + d[1] * n.dir[1] + d[2] * n.dir[2];
        if (k > b1) {
          b2 = b1;
          b1 = k;
          i1 = i;
        } else if (k > b2) b2 = k;
      });
      const edge = Math.min(1, (b1 - b2) * 9);
      const c = nuclei[i1]?.col ?? [0.5, 0.5, 0.5];
      const shade = 0.55 + 0.45 * edge;
      const o = (y * size + x) * 4;
      data[o] = c[0] * shade * 255;
      data[o + 1] = c[1] * shade * 255;
      data[o + 2] = c[2] * shade * 255;
      data[o + 3] = 255;
    }
  }
  return { w: size, h: size, data };
}

/** Tessa-like: colour-sphere measurement noise on top of the seed. */
function skinImage(seed: RGBA, r: () => number): RGBA {
  const out = new Uint8ClampedArray(seed.data);
  for (let i = 0; i < seed.w * seed.h; i++) {
    const o = i * 4;
    const shot = r() < 0.05;
    for (let c = 0; c < 3; c++) {
      const n = (r() - 0.5) * (shot ? 160 : 46);
      out[o + c] = Math.max(0, Math.min(255, out[o + c] * (0.9 + 0.25 * r()) + n));
    }
  }
  return { w: seed.w, h: seed.h, data: out };
}

/** Blur-like: decoherence smooths and desaturates. */
function tissueImage(skin: RGBA): RGBA {
  const { w, h } = skin;
  let src = new Float32Array(skin.data);
  for (let pass = 0; pass < 2; pass++) {
    const dst = new Float32Array(src.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        for (let c = 0; c < 4; c++) {
          let s = 0, n = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const yy = Math.max(0, Math.min(h - 1, y + dy));
              const xx = (x + dx + w) % w;
              s += src[(yy * w + xx) * 4 + c];
              n++;
            }
          dst[(y * w + x) * 4 + c] = s / n;
        }
    src = dst;
  }
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const l = (src[o] + src[o + 1] + src[o + 2]) / 3;
    for (let c = 0; c < 3; c++) out[o + c] = (l + (src[o + c] - l) * 0.8) * 0.92;
    out[o + 3] = 255;
  }
  return { w, h, data: out };
}

function proceduralSoma(r: () => number, n = 32): SomaArtifact {
  const bumps = Array.from({ length: 3 + Math.floor(r() * 3) }, (_, i) => ({
    u: r(),
    v: 0.2 + 0.6 * r(),
    a: i === 0 ? 1 : 0.25 + 0.5 * r(),
    s: 0.05 + 0.08 * r(),
  }));
  const grid: number[] = [];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, v = (y + 0.5) / n;
      let val = 0;
      for (const b of bumps) {
        let du = Math.abs(u - b.u);
        du = Math.min(du, 1 - du);
        const dv = v - b.v;
        val += b.a * Math.exp(-(du * du + dv * dv) / (2 * b.s * b.s));
      }
      grid.push(val);
    }
  const mx = Math.max(...grid);
  const g = grid.map((v) => v / mx);
  const mean = g.reduce((a, b) => a + b, 0) / g.length;
  return { size: n, grid: g, variance: g.reduce((a, b) => a + (b - mean) ** 2, 0) / g.length };
}

function proceduralLut(r: () => number, kind: "R" | "T", n = 32): Lut {
  const k = 1 + Math.floor(r() * 3);
  const ph = r();
  const data: number[] = [];
  for (let y = 0; y < n; y++) {
    const t = y / (n - 1);
    for (let x = 0; x < n; x++) {
      const s = x / n;
      const osc = 0.5 + 0.5 * Math.cos(Math.PI * 2 * (s * k + ph + t * 0.3));
      data.push(kind === "R" ? 0.2 + 0.9 * t * t + 0.35 * osc * (1 - 0.5 * t) : Math.max(0, (0.6 - 0.6 * t * t) * (0.4 + 0.6 * osc)));
    }
  }
  return { width: n, height: n, data };
}

/* --------------------------------------------------------------- builders */

function baseSpecimen(id: string, bytes: number[]): Specimen {
  return {
    id,
    name: `Specimen ${id.slice(0, 4).toUpperCase()}`,
    createdAt: new Date().toISOString(),
    generation: 0,
    controls: DEFAULT_CONTROLS,
    wounds: [],
    runs: {},
    genome: { hex: bytes.map((b) => b.toString(16).padStart(2, "0")).join(""), bytes, source: "qrng" },
  };
}

export function proceduralSpecimen(seed: number): Specimen {
  const r = rng(seed);
  const bytes = Array.from({ length: 32 }, () => Math.floor(r() * 256));
  const s = baseSpecimen(bytes.slice(0, 3).map((b) => b.toString(16).padStart(2, "0")).join(""), bytes);
  const nq = 6 + (bytes[4] % 5);
  const bloch: BlochVector[] = Array.from({ length: nq }, () => {
    const ct = r() * 2 - 1;
    const st = Math.sqrt(1 - ct * ct);
    const ph = r() * Math.PI * 2;
    const m = 0.3 + 0.65 * r();
    return { x: st * Math.cos(ph) * m, y: st * Math.sin(ph) * m, z: ct * m };
  });
  const seedImg = colonySeedImage(bloch);
  const skin = skinImage(seedImg, r);
  const tissue = tissueImage(skin);
  s.colony = {
    numQubits: nq,
    bloch,
    correlations: [],
    dominant: bytes.slice(0, nq).map((b) => b & 1).join(""),
    seed: { url: toDataUrl(seedImg), width: 32, height: 32 },
  };
  s.skin = { url: toDataUrl(skin), width: 32, height: 32 };
  s.tissue = { url: toDataUrl(tissue), width: 32, height: 32 };
  s.soma = proceduralSoma(r);
  s.membrane = {
    params: { reflectance: 0.3, absorption: 0.6, layers: 2, incoming_rays: 7, interaction: 0.5, style: "peaked", resolution: 32 },
    rLut: proceduralLut(r, "R"),
    tLut: proceduralLut(r, "T"),
  };
  return s;
}

/** Spike outputs of the real engines (graph-v1, tessa 21x21 fake_fez, blur-core 16x16, entanglement-shader LUTs). */
export function spikeSpecimen(): Specimen {
  const bytes = [
    0x7f, 0x3a, 0x9c, 0x51, 0x02, 0x6e, 0x21, 0xc4, 0x5d, 0x90, 0x33, 0xaa, 0x17, 0x62, 0xe9, 0x48, 0x0b, 0xd3, 0x76,
    0x3f, 0xb2, 0x95, 0x4c, 0x2e, 0xf1, 0x68, 0x87, 0x19, 0xc0, 0x5a, 0x24, 0xde,
  ];
  const s = baseSpecimen("5p1ke0", bytes);
  s.colony = {
    numQubits: FIXTURE_BLOCH.length,
    bloch: FIXTURE_BLOCH,
    correlations: FIXTURE_CORRELATIONS,
    dominant: FIXTURE_DOMINANT,
    seed: { url: FIXTURE_SEED_PNG, width: 32, height: 32 },
  };
  s.skin = { url: FIXTURE_TESSA_PNG, width: 21, height: 21 };
  // no tissue: exercises the tissue -> skin fallback
  const n = FIXTURE_SOMA.length;
  s.soma = { size: n, grid: FIXTURE_SOMA.flat(), variance: 0 };
  s.membrane = {
    params: { reflectance: 0.3, absorption: 0.7, layers: 2, incoming_rays: 7, interaction: 1, style: "peaked", resolution: 32 },
    rLut: FIXTURE_R_LUT,
    tLut: FIXTURE_T_LUT,
  };
  return s;
}

/** A synthetic soma grid (for the "fake soma" button). */
export function randomSoma(seed: number): SomaArtifact {
  return proceduralSoma(rng(seed));
}
