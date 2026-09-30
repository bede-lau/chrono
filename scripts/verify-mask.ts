/**
 * Offline verification of the wound mask (src/lib/imaging/mask.ts) and the sphere helpers (sphere.ts). OWNER: mask agent.
 * No network. Exits 1 if anything fails.
 *
 *   npx tsx scripts/verify-mask.ts
 *
 * What it proves (see docs/ROUND2.md section 1 and 2):
 *   - uvToDir/dirToUv are exact inverses of the shader's dirToUv (v = 1 north = top image row)
 *   - a north wound lands in the TOP rows, a south wound in the BOTTOM rows, u maps to columns
 *   - wounds are Gaussians in GREAT-CIRCLE distance: round at the equator, off the equator, on the u seam and at the pole
 *   - equal width along longitude and latitude (isotropy), pole wounds are round
 *   - 21 / 32 / 64 px (and odd sizes) work, baseline is a hard floor, values stay in 0..255
 *   - many overlapping wounds combine as a soft union and never flatten the map to solid white
 *   - output is deterministic
 *   - the VIEWPORT's own uvToDir/dirToUv (what a click records and what the ripple uses) agree with this convention
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Wound } from "../src/lib/chain/types";
import type { RGBAImage } from "../src/lib/imaging";
import { renderWoundMask, woundSigma, WOUND_EDGE_JITTER, WOUND_SIGMA_GAIN, WOUND_SIGMA_MIN } from "../src/lib/imaging/mask";
import { angleBetween, dirToUv, uvToDir, type Vec3 } from "../src/lib/imaging/sphere";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ───────────────────────────────────────────────────────────────── tiny test kit
let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed++;
    console.log(`  ok    ${name}${detail ? `  ${detail}` : ""}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? `  ${detail}` : ""}`);
  }
}
const section = (s: string) => console.log(`\n${s}`);
const f = (x: number, d = 3) => x.toFixed(d);

/** Deterministic PRNG (mulberry32) so a failure reproduces. */
function prng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wound = (u: number, v: number, strength = 1, t = 0): Wound => ({ u, v, strength, t });
const byteAt = (img: RGBAImage, x: number, y: number) => img.data[(y * img.width + x) * 4];
const valueAt = (img: RGBAImage, x: number, y: number) => byteAt(img, x, y) / 255;
/** Direction of the centre of pixel (px, py) under the documented convention. */
const pixelDir = (img: RGBAImage, px: number, py: number): Vec3 => uvToDir((px + 0.5) / img.width, 1 - (py + 0.5) / img.height);
/** Recover one wound's own contribution g from a mask value m = 1 - (1 - baseline)(1 - g). */
const gFrom = (m: number, baseline: number) => (baseline >= 1 ? 0 : 1 - (1 - m) / (1 - baseline));

function rowMeans(img: RGBAImage): number[] {
  const out: number[] = [];
  for (let y = 0; y < img.height; y++) {
    let s = 0;
    for (let x = 0; x < img.width; x++) s += byteAt(img, x, y);
    out.push(s / img.width);
  }
  return out;
}
const argmax = (a: number[]) => a.reduce((bi, v, i) => (v > a[bi] ? i : bi), 0);
/** Position (pixel coordinates) of the brightest pixel; ties average, so a wound centred between two pixels reads x.5. */
function brightest(img: RGBAImage): { x: number; y: number } {
  let mx = -1;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const v = byteAt(img, x, y);
      if (v > mx) {
        mx = v;
        sx = x;
        sy = y;
        n = 1;
      } else if (v === mx) {
        sx += x;
        sy += y;
        n++;
      }
    }
  return { x: sx / n, y: sy / n };
}

/**
 * How far is the mask from a great-circle Gaussian? For every pixel whose wound value g lies in [lo, hi] x strength, invert the
 * Gaussian to the implied angle and compare with the true great-circle angle from the pixel to the wound. Errors are in
 * units of sigma. Works at any latitude, on the seam and at the pole.
 */
function shapeError(img: RGBAImage, w: Wound, baseline: number, lo = 0.15, hi = 0.85) {
  const sigma = woundSigma(w.strength, img.height);
  const c = uvToDir(w.u, w.v);
  let n = 0;
  let sum = 0;
  let max = 0;
  for (let py = 0; py < img.height; py++)
    for (let px = 0; px < img.width; px++) {
      const g = gFrom(valueAt(img, px, py), baseline);
      if (g < lo * w.strength || g > hi * w.strength) continue;
      const a = angleBetween(pixelDir(img, px, py), c);
      const implied = sigma * Math.sqrt(2 * Math.log(w.strength / g));
      const err = Math.abs(implied - a) / sigma;
      sum += err;
      max = Math.max(max, err);
      n++;
    }
  return { n, mean: n ? sum / n : NaN, max };
}

/** Full width at half maximum (in radians of arc) along a sampled profile of wound values g: samples[i] at coordinate x[i]. */
function fwhm(x: number[], g: number[], peak: number, centreIndex: number): number {
  const half = peak / 2;
  const cross = (dir: 1 | -1): number => {
    let i = centreIndex;
    while (i + dir >= 0 && i + dir < g.length && g[i + dir] > half) i += dir;
    const j = i + dir;
    if (j < 0 || j >= g.length) return NaN;
    const t = (g[i] - half) / (g[i] - g[j]);
    return x[i] + t * (x[j] - x[i]);
  };
  return cross(1) - cross(-1);
}

// ───────────────────────────────────────────────────────────────── 1. sphere helpers
function testSphere(): void {
  section("1. sphere.ts: exact inverses of the shader mapping");
  const rnd = prng(1);
  let worstDir = 0;
  let worstUv = 0;
  let worstShader = 0;
  for (let i = 0; i < 10000; i++) {
    const z = 2 * rnd() - 1;
    const t = 2 * Math.PI * rnd();
    const r = Math.sqrt(1 - z * z);
    const d: Vec3 = [r * Math.cos(t), z, r * Math.sin(t)];
    const { u, v } = dirToUv(d);
    const d2 = uvToDir(u, v);
    worstDir = Math.max(worstDir, Math.hypot(d[0] - d2[0], d[1] - d2[1], d[2] - d2[2]));
    // the shader's own formula, literally: u = fract(atan(d.z, -d.x) / 2 pi), v = 1 - acos(clamp(d.y)) / pi
    let us = Math.atan2(d[2], -d[0]) / (2 * Math.PI);
    us -= Math.floor(us);
    const vs = 1 - Math.acos(Math.max(-1, Math.min(1, d[1]))) / Math.PI;
    worstShader = Math.max(worstShader, Math.min(Math.abs(u - us), 1 - Math.abs(u - us)), Math.abs(v - vs));
    const u0 = rnd();
    const v0 = rnd();
    const back = dirToUv(uvToDir(u0, v0));
    worstUv = Math.max(worstUv, Math.min(Math.abs(back.u - u0), 1 - Math.abs(back.u - u0)), Math.abs(back.v - v0));
  }
  check("10k random directions: dir -> (u,v) -> dir round trip < 1e-6", worstDir < 1e-6, `worst ${worstDir.toExponential(2)}`);
  check("10k random (u,v): (u,v) -> dir -> (u,v) round trip < 1e-6", worstUv < 1e-6, `worst ${worstUv.toExponential(2)}`);
  check("dirToUv matches the shader formula (atan/acos) < 1e-6", worstShader < 1e-6, `worst ${worstShader.toExponential(2)}`);
  const n = uvToDir(0.3, 1);
  const s = uvToDir(0.3, 0);
  check("v = 1 is the NORTH pole (+Y), v = 0 the SOUTH pole (-Y)", Math.abs(n[1] - 1) < 1e-12 && Math.abs(s[1] + 1) < 1e-12);
  check("dirToUv accepts {x,y,z} and un-normalised input", Math.abs(dirToUv({ x: 0, y: 5, z: 0 }).v - 1) < 1e-12 && Math.abs(dirToUv([0, 0, 3]).v - 0.5) < 1e-12);
  const u25 = dirToUv(uvToDir(0.25, 0.5)).u;
  check("u = 0.25 faces +Z, u wraps (u=1.25 -> 0.25)", Math.abs(u25 - 0.25) < 1e-12 && Math.abs(dirToUv(uvToDir(1.25, 0.5)).u - 0.25) < 1e-9);
  check("angleBetween is stable at 0 and pi", angleBetween([0, 1, 0], [0, 1, 0]) === 0 && Math.abs(angleBetween([0, 1, 0], [0, -1, 0]) - Math.PI) < 1e-12 && Math.abs(angleBetween([1, 0, 0], [Math.cos(1e-9), Math.sin(1e-9), 0]) - 1e-9) < 1e-15);
}

// ───────────────────────────────────────────────────────────────── 2. orientation
function testOrientation(): void {
  section("2. orientation: v = 1 north = TOP row, u = column");
  for (const N of [21, 32, 64]) {
    const north = renderWoundMask([wound(0.5, 0.97)], N, N, 0.15);
    const south = renderWoundMask([wound(0.5, 0.03)], N, N, 0.15);
    const rn = argmax(rowMeans(north));
    const rs = argmax(rowMeans(south));
    check(`${N}px north wound (v=0.97) -> brightest row in the TOP rows`, rn <= 1, `row ${rn} of 0..${N - 1}`);
    check(`${N}px south wound (v=0.03) -> brightest row in the BOTTOM rows`, rs >= N - 2, `row ${rs} of 0..${N - 1}`);
    const top = rowMeans(north).slice(0, 3).reduce((a, b) => a + b, 0);
    const bot = rowMeans(north).slice(-3).reduce((a, b) => a + b, 0);
    check(`${N}px north wound: top 3 rows brighter than bottom 3`, top > bot + 30, `${f(top, 0)} vs ${f(bot, 0)}`);
    // an off-pole wound sits where (1 - v) * H says
    const mid = renderWoundMask([wound(0.25, 0.75)], N, N, 0.15, { organic: 0 });
    const wantRow = (1 - 0.75) * N - 0.5;
    const wantCol = 0.25 * N - 0.5;
    // (the brightest PIXEL, not the row mean: an off-equator scar is wider in pixels nearer the pole, which skews row sums)
    const pk = brightest(mid);
    check(`${N}px wound (u=.25, v=.75) peaks at row ~${f(wantRow, 1)}, column ~${f(wantCol, 1)}`, Math.abs(pk.y - wantRow) <= 1 && Math.abs(pk.x - wantCol) <= 1, `row ${f(pk.y, 1)}, col ${f(pk.x, 1)}`);
  }
}

// ───────────────────────────────────────────────────────────────── 3. seam
function testSeam(): void {
  section("3. the u seam: a wound straddling it is one blob");
  for (const N of [32, 64]) {
    const base = 0.15;
    const b99 = renderWoundMask([wound(0.99, 0.5)], N, N, base, { organic: 0 });
    const b01 = renderWoundMask([wound(0.01, 0.5)], N, N, base, { organic: 0 });
    const row = Math.floor(N / 2);
    const left = valueAt(b99, 0, row);
    const right = valueAt(b99, N - 1, row);
    check(`${N}px wound at u=0.99 is bright on BOTH sides of the seam`, left > base + 0.3 && right > base + 0.3, `col 0 = ${f(left)}, col ${N - 1} = ${f(right)}`);
    // circular centroid of the wound's excess over baseline
    const centroid = (img: RGBAImage) => {
      let sx = 0;
      let sy = 0;
      for (let y = 0; y < img.height; y++)
        for (let x = 0; x < img.width; x++) {
          const w = Math.max(0, valueAt(img, x, y) - base);
          const phi = (2 * Math.PI * (x + 0.5)) / img.width;
          sx += w * Math.cos(phi);
          sy += w * Math.sin(phi);
        }
      const u = Math.atan2(sy, sx) / (2 * Math.PI);
      return ((u % 1) + 1) % 1;
    };
    const du = (a: number, b: number) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b));
    check(`${N}px circular centroid of the u=0.99 wound is u=0.99, of u=0.01 is u=0.01 (within 1/${N})`, du(centroid(b99), 0.99) < 1 / N && du(centroid(b01), 0.01) < 1 / N, `${f(centroid(b99), 4)} / ${f(centroid(b01), 4)}`);
    // the twin is the mirror image across the seam
    let worstMirror = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) worstMirror = Math.max(worstMirror, Math.abs(byteAt(b99, x, y) - byteAt(b01, N - 1 - x, y)));
    check(`${N}px twin at u=0.01 is the mirror image of u=0.99 (pure gaussian, max diff <= 1 level)`, worstMirror <= 1, `max diff ${worstMirror}`);
    // shifting u by whole pixels is a circular shift of the image (no seam artefact)
    let worstShift = 0;
    const a = renderWoundMask([wound(0.9, 0.4)], N, N, base, { organic: 0 });
    const k = 5;
    const shifted = renderWoundMask([wound((0.9 * N + k) / N - 1, 0.4)], N, N, base, { organic: 0 });
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) worstShift = Math.max(worstShift, Math.abs(byteAt(a, x, y) - byteAt(shifted, (x + k) % N, y)));
    check(`${N}px shifting the wound across the seam by ${k} px == circular shift of the image (max diff <= 1 level)`, worstShift <= 1, `max diff ${worstShift}`);
    // organic default: still the same blob
    const o99 = renderWoundMask([wound(0.99, 0.5)], N, N, base);
    const o01 = renderWoundMask([wound(0.01, 0.5)], N, N, base);
    let sumAbs = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) sumAbs += Math.abs(byteAt(o99, x, y) - byteAt(o01, N - 1 - x, y));
    const meanAbs = sumAbs / (N * N) / 255;
    check(`${N}px with the organic edge the two twins still overlay (mean abs diff < 0.03)`, meanAbs < 0.03, `mean abs diff ${f(meanAbs, 4)}`);
  }
}

// ───────────────────────────────────────────────────────────────── 4. great-circle shape + isotropy
function testShape(): void {
  section("4. great-circle Gaussian: round at the equator, off-equator, on the seam and at the poles");
  const spots: [string, Wound][] = [
    ["equator", wound(0.5, 0.5)],
    ["v=0.85", wound(0.3, 0.85)],
    ["seam u=0.995", wound(0.995, 0.5)],
    ["near north pole v=0.98", wound(0.7, 0.98)],
    ["north pole v=1", wound(0.2, 1)],
    ["south pole v=0", wound(0.6, 0)],
    ["weak strength 0.4 at v=0.3", wound(0.15, 0.3, 0.4)],
  ];
  for (const [N, tolMean, tolMax] of [
    [32, 0.03, 0.09],
    [64, 0.02, 0.06],
    [128, 0.015, 0.05],
  ] as const) {
    for (const [name, w] of spots) {
      const img = renderWoundMask([w], N, N, 0.15, { organic: 0 });
      const e = shapeError(img, w, 0.15);
      check(`${N}px ${name}: distance from centre (great-circle) predicts the value`, e.n > 8 && e.mean < tolMean && e.max < tolMax, `${e.n} px, error mean ${f(e.mean, 4)} sigma, max ${f(e.max, 4)} sigma`);
    }
  }

  // explicit lon vs lat extent of the half-maximum, measured as great-circle arc, at the equator
  const N = 256;
  const b = 0.15;
  const w = wound(0.5, 0.5);
  const img = renderWoundMask([w], N, N, b, { organic: 0 });
  const g = (px: number, py: number) => gFrom(valueAt(img, px, py), b);
  const lonG: number[] = [];
  const lonX: number[] = [];
  for (let px = 0; px < N; px++) {
    lonG.push((g(px, N / 2 - 1) + g(px, N / 2)) / 2); // equator is between rows N/2-1 and N/2
    lonX.push(((px + 0.5) / N) * 2 * Math.PI); // arc along the equator, radians
  }
  const latG: number[] = [];
  const latX: number[] = [];
  for (let py = 0; py < N; py++) {
    latG.push((g(N / 2 - 1, py) + g(N / 2, py)) / 2); // meridian u = 0.5 is between columns N/2-1 and N/2
    latX.push(((py + 0.5) / N) * Math.PI); // arc along the meridian, radians
  }
  const lon = fwhm(lonX, lonG, 1, N / 2);
  const lat = fwhm(latX, latG, 1, N / 2);
  const want = 2 * woundSigma(1, N) * Math.sqrt(2 * Math.LN2);
  check("equator wound: half-max extent along LONGITUDE equals along LATITUDE (arc, within 10 %)", Math.abs(lon / lat - 1) < 0.1, `lon ${f(lon, 4)} rad, lat ${f(lat, 4)} rad, ratio ${f(lon / lat, 4)}`);
  check("equator wound: extents match the analytic FWHM 2.355 sigma (within 3 %)", Math.abs(lon / want - 1) < 0.03 && Math.abs(lat / want - 1) < 0.03, `want ${f(want, 4)} rad`);
  const flatRatio = (lon / (2 * Math.PI)) / (lat / Math.PI);
  check("sanity: in PIXELS the same wound is ~2x taller than wide (the equirectangular oval)", Math.abs(flatRatio - 0.5) < 0.05, `pixel width/height ${f(flatRatio, 3)}`);

  // the same test with the default organic edge, statistically over many wounds
  const rnd = prng(7);
  let sum = 0;
  let lo = Infinity;
  let hi = 0;
  const M = 24;
  const NN = 128;
  for (let i = 0; i < M; i++) {
    const ww = wound(rnd(), 0.5);
    const im = renderWoundMask([ww], NN, NN, b);
    // extents through the wound centre along the parallel and the meridian; find the peak sample near the centre
    const cx = Math.round(ww.u * NN - 0.5);
    const gg = (px: number, py: number) => gFrom(valueAt(im, ((px % NN) + NN) % NN, py), b);
    const lx: number[] = [];
    const lg: number[] = [];
    for (let k = -NN / 2; k < NN / 2; k++) {
      lx.push(((cx + k + 0.5) / NN) * 2 * Math.PI);
      lg.push((gg(cx + k, NN / 2 - 1) + gg(cx + k, NN / 2)) / 2);
    }
    const ly: number[] = [];
    const lyg: number[] = [];
    for (let py = 0; py < NN; py++) {
      ly.push(((py + 0.5) / NN) * Math.PI);
      lyg.push((gg(cx, py) + gg(cx + 1, py)) / 2);
    }
    const peak = 1;
    const a1 = fwhm(lx, lg, peak, NN / 2);
    const a2 = fwhm(ly, lyg, peak, NN / 2);
    const ratio = a1 / a2;
    sum += ratio;
    lo = Math.min(lo, ratio);
    hi = Math.max(hi, ratio);
  }
  const meanRatio = sum / M;
  check(`organic edge: mean lon/lat extent ratio over ${M} random equator wounds within 10 % of 1`, Math.abs(meanRatio - 1) < 0.1, `mean ${f(meanRatio, 3)}, range ${f(lo, 2)}..${f(hi, 2)}`);
  check("organic edge stays gentle: every wound within 0.7..1.4 of round", lo > 0.7 && hi < 1.4);

  // pole wounds
  const P = 64;
  const pole = renderWoundMask([wound(0.37, 1)], P, P, b, { organic: 0 });
  let worstRow = 0;
  for (let y = 0; y < P; y++) {
    let mn = 255;
    let mx = 0;
    for (let x = 0; x < P; x++) {
      mn = Math.min(mn, byteAt(pole, x, y));
      mx = Math.max(mx, byteAt(pole, x, y));
    }
    worstRow = Math.max(worstRow, mx - mn);
  }
  check("pole wound (v=1, pure) is round: every row is constant across all columns", worstRow <= 1, `max spread ${worstRow} level(s)`);
  const northSouth = renderWoundMask([wound(0.2, 1)], P, P, b, { organic: 0 });
  const south = renderWoundMask([wound(0.2, 0)], P, P, b, { organic: 0 });
  let worstFlip = 0;
  for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) worstFlip = Math.max(worstFlip, Math.abs(byteAt(northSouth, x, y) - byteAt(south, x, P - 1 - y)));
  check("north-pole and south-pole wounds are mirror images top/bottom", worstFlip <= 1, `max diff ${worstFlip}`);
  // organic pole wound: half-max radius vs azimuth stays within a gentle band
  const PP = 256;
  const op = renderWoundMask([wound(0.37, 1)], PP, PP, b);
  let rMin = Infinity;
  let rMax = 0;
  for (let x = 0; x < PP; x += 4) {
    const col: number[] = [];
    const xs: number[] = [];
    for (let y = 0; y < PP; y++) {
      col.push(gFrom(valueAt(op, x, y), b));
      xs.push(((y + 0.5) / PP) * Math.PI); // polar angle from the north pole
    }
    let y = 0;
    while (y + 1 < PP && col[y + 1] > 0.5) y++;
    const t = (col[y] - 0.5) / (col[y] - col[y + 1]);
    const r = xs[y] + t * (xs[y + 1] - xs[y]);
    rMin = Math.min(rMin, r);
    rMax = Math.max(rMax, r);
  }
  check("organic pole wound: half-max radius varies by less than 1.4x around the pole", rMax / rMin < 1.4, `${f(rMin, 3)}..${f(rMax, 3)} rad (${f(rMax / rMin, 3)}x)`);
}

// ───────────────────────────────────────────────────────────────── 5. sizes, baseline, range
function testSizesBaselineRange(): void {
  section("5. sizes, baseline, value range");
  const ws = [wound(0.12, 0.55), wound(0.38, 0.32), wound(0.66, 0.68, 0.8), wound(0.88, 0.94)];
  for (const [W, H] of [
    [21, 21],
    [32, 32],
    [64, 64],
    [48, 24],
    [7, 5],
    [1, 1],
  ]) {
    const img = renderWoundMask(ws, W, H, 0.15);
    let ok = img.width === W && img.height === H && img.data.length === W * H * 4;
    let grey = true;
    let opaque = true;
    let mn = 255;
    let mx = 0;
    for (let i = 0; i < W * H; i++) {
      const r = img.data[i * 4];
      grey &&= r === img.data[i * 4 + 1] && r === img.data[i * 4 + 2];
      opaque &&= img.data[i * 4 + 3] === 255;
      mn = Math.min(mn, r);
      mx = Math.max(mx, r);
    }
    ok = ok && grey && opaque;
    check(`${W}x${H}: size, opaque greyscale RGBA, range ${mn}..${mx}`, ok && mn >= Math.round(0.15 * 255) && mx <= 255);
  }
  for (const b of [0, 0.15, 0.17, 0.3, 1]) {
    const flat = renderWoundMask([], 21, 21, b);
    const want = Math.round(b * 255);
    check(`zero wounds: every pixel is exactly the baseline byte (baseline ${b} -> ${want})`, flat.data.every((v, i) => i % 4 === 3 || v === want));
  }
  const withW = renderWoundMask(ws, 32, 32, 0.15);
  let minByte = 255;
  for (let i = 0; i < 32 * 32; i++) minByte = Math.min(minByte, withW.data[i * 4]);
  check("baseline is a hard floor: no pixel below round(0.15 * 255) = 38", minByte >= 38, `min ${minByte}`);
  const one = renderWoundMask([wound(0.5, 0.5)], 32, 32, 0.15);
  check("the side of the sphere far from the only wound is exactly the baseline", byteAt(one, 0, 16) === 38 && byteAt(one, 31, 16) === 38 && byteAt(one, 0, 0) === 38 && byteAt(one, 0, 31) === 38, `${byteAt(one, 0, 16)}, ${byteAt(one, 31, 16)}, ${byteAt(one, 0, 0)}, ${byteAt(one, 0, 31)}`);
  const peak = renderWoundMask([wound((15 + 0.5) / 32, 1 - (15 + 0.5) / 32)], 32, 32, 0.15, { organic: 0, samples: 1 });
  check("a strength-1 wound centred on a pixel reaches full white there", byteAt(peak, 15, 15) === 255, `${byteAt(peak, 15, 15)}`);
  const weak = renderWoundMask([wound((15 + 0.5) / 32, 1 - (15 + 0.5) / 32, 0.5)], 32, 32, 0.15, { organic: 0, samples: 1 });
  check("a strength-0.5 wound peaks at 1 - (1 - baseline)(1 - 0.5) = 0.575", Math.abs(byteAt(weak, 15, 15) - Math.round(0.575 * 255)) <= 1, `${byteAt(weak, 15, 15)} vs ${Math.round(0.575 * 255)}`);
  // garbage in, sane out
  const junk = renderWoundMask(
    [wound(NaN, 0.5), wound(0.5, Infinity), wound(0.5, 0.5, 0), wound(0.5, 0.5, -1), wound(0.5, 0.5, 7), wound(2.75, -3, 0.5)],
    16,
    16,
    Number.NaN,
  );
  check("NaN / infinite / zero / out-of-range wounds and a NaN baseline do not throw or poison the image", junk.data.every((v) => Number.isInteger(v) && v >= 0 && v <= 255));
  const over = renderWoundMask([wound(0.5, 0.5, 7)], 16, 16, 0.15, { organic: 0, samples: 1 });
  const capped = renderWoundMask([wound(0.5, 0.5, 1)], 16, 16, 0.15, { organic: 0, samples: 1 });
  check("strength above 1 is clamped to 1", over.data.every((v, i) => v === capped.data[i]));
  const t0 = performance.now();
  const many = Array.from({ length: 24 }, (_, i) => wound((i * 0.137) % 1, 0.1 + ((i * 0.31) % 0.8)));
  renderWoundMask(many, 64, 64, 0.15);
  const ms = performance.now() - t0;
  check("24 wounds at 64x64 render in under 1.5 s (browser-safe)", ms < 1500, `${f(ms, 0)} ms`);
  const sig = [woundSigma(0), woundSigma(1), woundSigma(0.5), woundSigma(0, 8), woundSigma(1, 64)];
  check("woundSigma: 0.22 + 0.16 s rad, floor of 1.5 texels of latitude", Math.abs(sig[0] - WOUND_SIGMA_MIN) < 1e-12 && Math.abs(sig[1] - (WOUND_SIGMA_MIN + WOUND_SIGMA_GAIN)) < 1e-12 && Math.abs(sig[2] - 0.3) < 1e-12 && Math.abs(sig[3] - (1.5 * Math.PI) / 8) < 1e-12 && Math.abs(sig[4] - 0.38) < 1e-12, `${sig.map((x) => f(x, 4)).join(" ")}`);
  check("edge jitter constant is 15 %", WOUND_EDGE_JITTER === 0.15);
}

// ───────────────────────────────────────────────────────────────── 6. combining wounds
function testCombine(): void {
  section("6. soft union: overlapping wounds never saturate to solid white");
  const rnd = prng(3);
  const cluster: Wound[] = Array.from({ length: 12 }, () => wound(0.5 + (rnd() - 0.5) * 0.12, 0.5 + (rnd() - 0.5) * 0.3, 1));
  for (const N of [21, 32, 64]) {
    const img = renderWoundMask(cluster, N, N, 0.15);
    let white = 0;
    let sum = 0;
    let minByte = 255;
    for (let i = 0; i < N * N; i++) {
      const v = img.data[i * 4];
      if (v >= 250) white++;
      sum += v;
      minByte = Math.min(minByte, v);
    }
    check(`${N}px: 12 overlapping full-strength wounds leave the map far from solid white`, white / (N * N) < 0.35 && sum / (N * N) / 255 < 0.75, `${f((100 * white) / (N * N), 1)} % of pixels >= 250, mean ${f(sum / (N * N) / 255, 3)}`);
    check(`${N}px: ... and the far side of the blob is still exactly baseline`, minByte === 38, `min ${minByte}`);
  }
  // union law at a pixel centre
  const N = 32;
  const at = wound((10 + 0.5) / N, 1 - (20 + 0.5) / N, 0.5);
  const b = 0.15;
  const one = byteAt(renderWoundMask([at], N, N, b, { organic: 0, samples: 1 }), 10, 20);
  const two = byteAt(renderWoundMask([at, at], N, N, b, { organic: 0, samples: 1 }), 10, 20);
  const four = byteAt(renderWoundMask([at, at, at, at], N, N, b, { organic: 0, samples: 1 }), 10, 20);
  const expect = (n: number) => Math.round(255 * (1 - (1 - b) * Math.pow(1 - 0.5, n)));
  check("union law 1 - (1 - baseline) * prod(1 - g): 1, 2, 4 identical half-strength wounds", Math.abs(one - expect(1)) <= 1 && Math.abs(two - expect(2)) <= 1 && Math.abs(four - expect(4)) <= 1, `${one}/${two}/${four} vs ${expect(1)}/${expect(2)}/${expect(4)}`);
  // adding wounds never lowers any pixel
  const a1 = renderWoundMask(cluster.slice(0, 1), 32, 32, b);
  const a6 = renderWoundMask(cluster.slice(0, 6), 32, 32, b);
  const a12 = renderWoundMask(cluster, 32, 32, b);
  let mono = true;
  for (let i = 0; i < 32 * 32; i++) mono &&= a6.data[i * 4] >= a1.data[i * 4] && a12.data[i * 4] >= a6.data[i * 4];
  check("monotonic: 12 wounds >= 6 wounds >= 1 wound at every pixel", mono);
}

// ───────────────────────────────────────────────────────────────── 7. determinism + isomorphism
function testDeterminism(): void {
  section("7. determinism and isomorphism");
  const ws = [wound(0.2, 0.4, 0.9, 111), wound(0.71, 0.66, 1, 222), wound(0.99, 0.93, 0.6, 333)];
  const a = renderWoundMask(ws, 32, 32, 0.15);
  const b = renderWoundMask(ws.map((w) => ({ ...w })), 32, 32, 0.15);
  check("same wounds -> byte-identical mask", a.data.every((v, i) => v === b.data[i]));
  const retimed = renderWoundMask(ws.map((w) => ({ ...w, t: w.t + 99999 })), 32, 32, 0.15);
  check("the wound timestamp does not affect the mask", a.data.every((v, i) => v === retimed.data[i]));
  const reordered = renderWoundMask([ws[2], ws[0], ws[1]], 32, 32, 0.15);
  let worst = 0;
  for (let i = 0; i < a.data.length; i++) worst = Math.max(worst, Math.abs(a.data[i] - reordered.data[i]));
  check("wound order does not matter (union is commutative, <= 1 level of float rounding)", worst <= 1, `max diff ${worst}`);
  const moved = renderWoundMask([wound(0.2, 0.4, 0.9), wound(0.71, 0.66, 1), wound(0.99, 0.93, 0.6)], 32, 32, 0.15, { organic: 0 });
  const stillMoved = a.data.some((v, i) => v !== moved.data[i]);
  check("the organic edge is real: it changes the mask vs. the pure gaussian", stillMoved);
  let diff = 0;
  for (let i = 0; i < a.data.length; i += 4) diff = Math.max(diff, Math.abs(a.data[i] - moved.data[i]));
  check("...but only slightly (max change < 25 % of full scale at 32 px)", diff < 64, `max change ${diff} levels`);
  for (const rel of ["src/lib/imaging/mask.ts", "src/lib/imaging/sphere.ts"]) {
    const src = readFileSync(path.join(ROOT, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const bad = /\bnode:|\brequire\(|\bBuffer\b|\bprocess\.|\bdocument\.|\bwindow\.|Math\.random/.exec(src);
    check(`${rel} is isomorphic and deterministic (no node:, Buffer, DOM or Math.random)`, !bad, bad ? `found "${bad[0]}"` : "");
  }
}

// ───────────────────────────────────────────────────────────────── 8. viewport convention cross-check
async function testViewportConvention(): Promise<void> {
  section("8. the VIEWPORT's wound direction helpers agree with the mask convention");
  // shader source: the texture lookup every image (skin/tissue/mask) is sampled with
  try {
    const shaders = readFileSync(path.join(ROOT, "src/components/organism/shaders.ts"), "utf8");
    const okV = /float v = 1\.0 - acos\(clamp\(d\.y, -1\.0, 1\.0\)\) \/ PI;/.test(shaders);
    const okU = /float u = fract\(atan\(d\.z, -d\.x\) \/ TWO_PI\);/.test(shaders);
    check("shaders.ts dirToUv is still u = fract(atan(d.z,-d.x)/2pi), v = 1 - acos(d.y)/pi", okU && okV, okU && okV ? "" : "the shader mapping changed: update src/lib/imaging/sphere.ts to match");
  } catch (e) {
    check("shaders.ts readable", false, (e as Error).message);
  }
  // artifacts.ts: pick() records a click with dirToUv; rig.updateWounds turns a wound back into a ripple with uvToDir
  const spec = "../src/components/organism/artifacts";
  type ViewportHelpers = { uvToDir?: (u: number, v: number) => Vec3; dirToUv?: (d: Vec3) => { u: number; v: number } };
  let vp: ViewportHelpers | null = null;
  try {
    vp = (await import(spec)) as ViewportHelpers;
  } catch (e) {
    console.log(`  skip  could not import the viewport helpers (${(e as Error).message})`);
    return;
  }
  const vpUvToDir = vp?.uvToDir;
  const vpDirToUv = vp?.dirToUv;
  if (!vpUvToDir || !vpDirToUv) {
    console.log("  skip  viewport helpers uvToDir/dirToUv not exported from artifacts.ts");
    return;
  }
  const north = vpDirToUv([0, 1, 0]);
  const south = vpDirToUv([0, -1, 0]);
  const hint = "src/components/organism/artifacts.ts must use theta = pi * (1 - v) in uvToDir and v = 1 - theta / pi in dirToUv (or re-export both from src/lib/imaging/sphere); nucleusFromBloch then needs uvToDir(.., 1 - theta / pi)";
  check("a click on the NORTH pole records Wound.v = 1 (viewport dirToUv)", Math.abs(north.v - 1) < 1e-9, `v = ${f(north.v, 3)}${Math.abs(north.v - 1) < 1e-9 ? "" : `  -> ${hint}`}`);
  check("a click on the SOUTH pole records Wound.v = 0 (viewport dirToUv)", Math.abs(south.v) < 1e-9, `v = ${f(south.v, 3)}`);
  const rnd = prng(11);
  let worstDir = 0;
  let worstUv = 0;
  for (let i = 0; i < 500; i++) {
    const u = rnd();
    const v = rnd();
    const a = vpUvToDir(u, v);
    const b = uvToDir(u, v);
    worstDir = Math.max(worstDir, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    const z = 2 * rnd() - 1;
    const t = 2 * Math.PI * rnd();
    const r = Math.sqrt(1 - z * z);
    const d: Vec3 = [r * Math.cos(t), z, r * Math.sin(t)];
    const p = vpDirToUv(d);
    const q = dirToUv(d);
    worstUv = Math.max(worstUv, Math.min(Math.abs(p.u - q.u), 1 - Math.abs(p.u - q.u)), Math.abs(p.v - q.v));
  }
  check("viewport uvToDir == sphere.ts uvToDir for 500 random (u,v)  (ripple lands where the mask scar is)", worstDir < 1e-9, `worst ${worstDir.toExponential(2)}${worstDir < 1e-9 ? "" : `  -> ${hint}`}`);
  check("viewport dirToUv == sphere.ts dirToUv for 500 random directions  (click -> Wound -> mask row)", worstUv < 1e-9, `worst ${worstUv.toExponential(2)}`);
}

// ───────────────────────────────────────────────────────────────── run
async function main(): Promise<void> {
  const t0 = performance.now();
  testSphere();
  testOrientation();
  testSeam();
  testShape();
  testSizesBaselineRange();
  testCombine();
  testDeterminism();
  await testViewportConvention();
  const total = passed + failures.length;
  console.log(`\nverify-mask: ${passed}/${total} checks passed in ${f(performance.now() - t0, 0)} ms`);
  if (failures.length) {
    console.log(`FAILED (${failures.length}):`);
    for (const n of failures) console.log(`  - ${n}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
