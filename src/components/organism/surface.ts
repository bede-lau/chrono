/**
 * CPU mirror of the organism's vertex displacement (shaders.ts `displacement` / `surfaceAt`), so a pointer can be
 * resolved to the exact point of the visible, displaced surface: accurate wounds, and a linked probe whose (u, v),
 * incidence angle θ and thin-film phase match what the fragment shader computes at that pixel.
 * OWNER: viewport agent. Allocation-free on the hot path.
 */
import type { IUniform, Matrix3, Matrix4, Vector2, Vector3, Vector4 } from "three";
import { SOMA_RES } from "./artifacts";

/* ---------------------------------------------------- Ashima 3D simplex noise */

const mod289 = (x: number) => x - Math.floor(x * (1 / 289)) * 289;
const permute = (x: number) => mod289((x * 34 + 1) * x);
const taylorInvSqrt = (r: number) => 1.79284291400159 - 0.85373472095314 * r;

const G = new Float64Array(12);
function grad(p: number, k: number) {
  const nsx = 2 / 7, nsy = 0.5 / 7 - 1, nsz = 1 / 7;
  const j = p - 49 * Math.floor(p * nsz * nsz);
  const x_ = Math.floor(j * nsz);
  const y_ = Math.floor(j - 7 * x_);
  const x = x_ * nsx + nsy;
  const y = y_ * nsx + nsy;
  const h = 1 - Math.abs(x) - Math.abs(y);
  const sh = h <= 0 ? -1 : 0;
  let gx = x + (Math.floor(x) * 2 + 1) * sh;
  let gy = y + (Math.floor(y) * 2 + 1) * sh;
  let gz = h;
  const n = taylorInvSqrt(gx * gx + gy * gy + gz * gz);
  gx *= n;
  gy *= n;
  gz *= n;
  G[k * 3] = gx;
  G[k * 3 + 1] = gy;
  G[k * 3 + 2] = gz;
}

/** Same as the GLSL `snoise(vec3)` in shaders.ts. */
export function snoise(vx: number, vy: number, vz: number): number {
  const C1 = 1 / 6, C2 = 1 / 3;
  const s = (vx + vy + vz) * C2;
  let ix = Math.floor(vx + s), iy = Math.floor(vy + s), iz = Math.floor(vz + s);
  const t = (ix + iy + iz) * C1;
  const x0 = vx - ix + t, y0 = vy - iy + t, z0 = vz - iz + t;
  const gx = x0 >= y0 ? 1 : 0, gy = y0 >= z0 ? 1 : 0, gz = z0 >= x0 ? 1 : 0;
  const lx = 1 - gx, ly = 1 - gy, lz = 1 - gz;
  const i1x = Math.min(gx, lz), i1y = Math.min(gy, lx), i1z = Math.min(gz, ly);
  const i2x = Math.max(gx, lz), i2y = Math.max(gy, lx), i2z = Math.max(gz, ly);
  const x1 = x0 - i1x + C1, y1 = y0 - i1y + C1, z1 = z0 - i1z + C1;
  const x2 = x0 - i2x + C2, y2 = y0 - i2y + C2, z2 = z0 - i2z + C2;
  const x3 = x0 - 0.5, y3 = y0 - 0.5, z3 = z0 - 0.5;
  ix = mod289(ix);
  iy = mod289(iy);
  iz = mod289(iz);
  grad(permute(permute(permute(iz) + iy) + ix), 0);
  grad(permute(permute(permute(iz + i1z) + iy + i1y) + ix + i1x), 1);
  grad(permute(permute(permute(iz + i2z) + iy + i2y) + ix + i2x), 2);
  grad(permute(permute(permute(iz + 1) + iy + 1) + ix + 1), 3);
  let m0 = Math.max(0.6 - (x0 * x0 + y0 * y0 + z0 * z0), 0);
  let m1 = Math.max(0.6 - (x1 * x1 + y1 * y1 + z1 * z1), 0);
  let m2 = Math.max(0.6 - (x2 * x2 + y2 * y2 + z2 * z2), 0);
  let m3 = Math.max(0.6 - (x3 * x3 + y3 * y3 + z3 * z3), 0);
  m0 *= m0;
  m1 *= m1;
  m2 *= m2;
  m3 *= m3;
  return (
    42 *
    (m0 * m0 * (G[0] * x0 + G[1] * y0 + G[2] * z0) +
      m1 * m1 * (G[3] * x1 + G[4] * y1 + G[5] * z1) +
      m2 * m2 * (G[6] * x2 + G[7] * y2 + G[8] * z2) +
      m3 * m3 * (G[9] * x3 + G[10] * y3 + G[11] * z3))
  );
}

/* ------------------------------------------------------- field sampling */

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function bspline(v: number, out: Float64Array) {
  const a = 1 - v, b = 2 - v, c = 3 - v, d = 4 - v;
  const s0 = a * a * a, s1 = b * b * b, s2 = c * c * c;
  const x = s0;
  const y = s1 - 4 * s0;
  const z = s2 - 4 * s1 + 6 * s0;
  const w = 6 - x - y - z;
  void d;
  out[0] = x / 6;
  out[1] = y / 6;
  out[2] = z / 6;
  out[3] = w / 6;
}
const WX = new Float64Array(4);
const WY = new Float64Array(4);

/** Cubic B-spline sample of a R x R texture-layout field (row 0 = v 0 = south), u repeats, v clamps. */
function bicubic(values: Float32Array, u: number, v: number): number {
  const R = SOMA_RES;
  const fx = u * R - 0.5;
  const fy = v * R - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  bspline(fx - x0, WX);
  bspline(fy - y0, WY);
  let s = 0;
  for (let b = 0; b < 4; b++) {
    const yy = Math.min(R - 1, Math.max(0, y0 - 1 + b));
    let row = 0;
    for (let a = 0; a < 4; a++) row += WX[a] * values[yy * R + ((((x0 - 1 + a) % R) + R) % R)];
    s += WY[b] * row;
  }
  return s;
}

function fieldAt(values: Float32Array, pole: Vector2, dx: number, dy: number, dz: number): number {
  let u = Math.atan2(dz, -dx) / (Math.PI * 2);
  u -= Math.floor(u);
  const v = 1 - Math.acos(Math.min(1, Math.max(-1, dy))) / Math.PI;
  const val = bicubic(values, u, v);
  const w = smoothstep(0.04, 0.26, Math.hypot(dx, dz));
  const p = dy > 0 ? pole.x : pole.y;
  return p + (val - p) * w;
}

/* ------------------------------------------------------------- surface */

type U = Record<string, IUniform>;

/**
 * Evaluates the organism's displaced surface on the CPU from the live uniform values (the same objects the GPU
 * reads) plus the CPU copies of the soma / relief fields, including transient wound ripples and audio shiver.
 */
export class SurfaceSampler {
  /** Last `displacement` outputs. */
  field = 0;
  disp = 0;

  constructor(
    private readonly u: U,
    private readonly soma: Float32Array,
    private readonly relief: Float32Array,
  ) {}

  displacement(dx: number, dy: number, dz: number, side: number): number {
    const u = this.u;
    const mixv = (v: Vector2) => v.x + (v.y - v.x) * side;
    const gen = mixv(u.uLGen.value as Vector2);
    const col = mixv(u.uLCol.value as Vector2);
    const som = mixv(u.uLSom.value as Vector2);
    const voi = mixv(u.uLVoi.value as Vector2);
    const seed = u.uSeed.value as Vector3;
    const time = u.uTime.value as number;
    const form =
      snoise(dx * 1.1 + seed.x, dy * 1.1 + seed.y, dz * 1.1 + seed.z) * 0.085 +
      snoise(dx * 2.3 + seed.y + time * 0.035, dy * 2.3 + seed.z + time * 0.035, dz * 2.3 + seed.x + time * 0.035) * 0.03;
    const lobesU = u.uLobes.value as Vector4[];
    const sharp = u.uLobeSharp.value as Float32Array;
    let lobes = 0;
    for (let i = 0; i < lobesU.length; i++) {
      const l = lobesU[i];
      lobes += l.w * Math.exp(sharp[i] * (dx * l.x + dy * l.y + dz * l.z - 1));
    }
    const base =
      (u.uFormAmp.value as number) * gen * (form + lobes) +
      (u.uReliefAmp.value as number) * col * fieldAt(this.relief, u.uReliefPole.value as Vector2, dx, dy, dz);
    const pole = u.uSomaPole.value as Vector2;
    const e = u.uEntangle.value as number;
    this.field = fieldAt(this.soma, pole, dx, dy, dz) - e * fieldAt(this.soma, pole, -dx, -dy, -dz);
    const bp = u.uBreathPhase.value as number;
    const br =
      voi *
      (u.uBreath.value as number) *
      (0.65 * Math.sin(bp - dy * 1.4) + 0.35 * snoise(dx * 1.6 + bp * 0.15, dy * 1.6 + bp * 0.15, dz * 1.6 + bp * 0.15));
    let transient = voi * (u.uShiver.value as number) * snoise(dx * 7 + time * 2.2, dy * 7 + time * 2.2, dz * 7 + time * 2.2);
    const wounds = u.uWounds.value as Vector4[];
    const strengths = u.uWoundStrength.value as Float32Array;
    const ripple = (angle: number, age: number) => {
      const x = angle - age * 0.85;
      return Math.cos(x * 20) * Math.exp(-x * x * 22 - age * 0.95) * 0.032 - Math.exp(-angle * angle * 70 - age * 3.2) * 0.055;
    };
    for (let i = 0; i < (u.uWoundCount.value as number); i++) {
      const wound = wounds[i];
      const angle = Math.acos(Math.max(-1, Math.min(1, dx * wound.x + dy * wound.y + dz * wound.z)));
      transient += strengths[i] * (ripple(angle, wound.w) + e * 0.85 * ripple(Math.PI - angle, wound.w));
    }
    this.disp = base + (u.uSomaAmp.value as number) * som * this.field + br + transient;
    return this.disp;
  }

  /** Displaced surface point for unit direction d (object space). */
  point(dx: number, dy: number, dz: number, side: number, out: Vector3): Vector3 {
    const disp = this.displacement(dx, dy, dz, side);
    const st = this.u.uStretch.value as Vector3;
    const gen = this.u.uLGen.value as Vector2;
    const g = gen.x + (gen.y - gen.x) * side;
    return out.set(dx * (1 + (st.x - 1) * g) * (1 + disp), dy * (1 + (st.y - 1) * g) * (1 + disp), dz * (1 + (st.z - 1) * g) * (1 + disp));
  }

  /** Stretched radius factor along object-space direction (for inside tests). */
  stretchAt(side: number, out: Vector3): Vector3 {
    const st = this.u.uStretch.value as Vector3;
    const gen = this.u.uLGen.value as Vector2;
    const g = gen.x + (gen.y - gen.x) * side;
    return out.set(1 + (st.x - 1) * g, 1 + (st.y - 1) * g, 1 + (st.z - 1) * g);
  }
}

export interface PickResult {
  /** Unit direction on the (undisplaced) sphere, object space. */
  dir: Vector3;
  /** Surface point, object space. */
  point: Vector3;
  u: number;
  /** v = 1 north (Wound convention). */
  v: number;
  /** Incidence angle 0..π/2 between the surface normal and the view direction. */
  theta: number;
  cosTheta: number;
  /** NDC x of the base point (compare-wipe side test). */
  side: number;
}

/** Scratch vectors are supplied by the caller (the rig) to keep this allocation-free. */
export interface PickScratch {
  o: Vector3;
  dir: Vector3;
  p: Vector3;
  q: Vector3;
  s: Vector3;
  t: Vector3;
  b: Vector3;
  n: Vector3;
  p1: Vector3;
  p2: Vector3;
  inv: Matrix4;
  mv: Matrix4;
  nm: Matrix3;
}
