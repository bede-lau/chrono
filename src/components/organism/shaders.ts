/**
 * GLSL for the organism, its Chrono Lens overlays (genome sparks, entangled links, echo shells), the stage backdrop,
 * suspended dust and colony nuclei. OWNER: viewport agent.
 *
 * Conventions:
 *  - Displacement and colour are functions of the undisplaced unit direction d (object space), so there are no
 *    seams/poles artefacts; d -> uv uses three's SphereGeometry mapping (u = longitude, v = latitude, v=1 north).
 *  - Membrane iridescence follows the Entanglement Shader GLSL contract exactly (see docs/BRIEF.md §3):
 *    D = -2·2π·thickness·cosθ, s_c = mod(D/λ_c, 2π)/2π for λ = (650, 530, 470) nm, t = θ/(π/2).
 *  - Chrono Lens: every engine's contribution is scaled by a per-stage amount given as vec2(without-side, with-side).
 *    `uWipe` (x = wipe NDC x, y = compare 0..1, z = half width) picks the side per vertex; compare off => side = 1.
 *  - Any change to `displacement` must be mirrored in surface.ts (CPU picking / linked probe).
 */

export const MAX_WOUNDS = 16;
export const MAX_NUCLEI = 12;
export const MAX_SCARS = 8;
export const MAX_LINKS = 6;

const COMMON = /* glsl */ `
#define PI 3.141592653589793
#define TWO_PI 6.283185307179586
#define HALF_PI 1.5707963267948966

// d (unit, object space) -> texture uv (u = longitude, v = 1 at the north pole / image top row)
vec2 dirToUv(vec3 d) {
  float u = fract(atan(d.z, -d.x) / TWO_PI);
  float v = 1.0 - acos(clamp(d.y, -1.0, 1.0)) / PI;
  return vec2(u, v);
}

// Cubic B-spline weights; bicubic via 4 bilinear taps (smooth, no ringing) — tiny artifacts read as tissue, not pixels.
vec4 bsplineW(float v) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
  vec4 s = n * n * n;
  float x = s.x;
  float y = s.y - 4.0 * s.x;
  float z = s.z - 4.0 * s.y + 6.0 * s.x;
  float w = 6.0 - x - y - z;
  return vec4(x, y, z, w) * (1.0 / 6.0);
}
vec4 textureBicubic(sampler2D tex, vec2 uv, vec2 size) {
  vec2 inv = 1.0 / size;
  vec2 st = uv * size - 0.5;
  vec2 f = fract(st);
  st -= f;
  vec4 xc = bsplineW(f.x);
  vec4 yc = bsplineW(f.y);
  vec4 c = st.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
  vec4 o = (c + vec4(xc.yw, yc.yw) / s) * inv.xxyy;
  vec4 s0 = textureLod(tex, o.xz, 0.0);
  vec4 s1 = textureLod(tex, o.yz, 0.0);
  vec4 s2 = textureLod(tex, o.xw, 0.0);
  vec4 s3 = textureLod(tex, o.yw, 0.0);
  float sx = s.x / (s.x + s.y);
  float sy = s.z / (s.z + s.w);
  return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
}

// Ashima 3D simplex noise (MIT). Mirrored in surface.ts.
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

const WOUND_UNIFORMS = /* glsl */ `
#define MAX_WOUNDS ${MAX_WOUNDS}
uniform int uWoundCount;
uniform vec4 uWounds[MAX_WOUNDS];        // xyz = wound direction, w = age (s)
uniform float uWoundStrength[MAX_WOUNDS];
uniform float uEntangle;                 // live Entanglement slider: antipodal coupling
`;

/**
 * The organism's surface: genome form (01) + colony relief (02) + entangled soma field (05) + wound ripples +
 * breathing (07), each scaled by its lens amount. Shared by the body, genome sparks, entangled links and echo shells.
 * Define CHEAP_SURFACE to skip the transient wound ripples and shiver (overlay geometry).
 */
const DISPLACE = /* glsl */ `
#define LOBES 5
uniform float uTime;
uniform sampler2D uSoma;          // standardised displacement field (-1, 1) from blur-core-v1, v = 1 north
uniform vec2 uSomaSize;
uniform float uSomaAmp;
uniform vec2 uSomaPole;           // field value at the north / south pole
uniform sampler2D uRelief;        // colony macro-cells (from the colony seed), same layout as uSoma
uniform float uReliefAmp;
uniform vec2 uReliefPole;
uniform vec4 uLobes[LOBES];       // genome lobes: xyz dir, w amplitude
uniform float uLobeSharp[LOBES];
uniform vec3 uSeed;
uniform vec3 uStretch;
uniform float uFormAmp;
uniform float uBreath;
uniform float uBreathPhase;
uniform float uShiver;
uniform vec2 uLGen;               // lens amounts (without-side, with-side)
uniform vec2 uLCol;
uniform vec2 uLSom;
uniform vec2 uLVoi;
uniform vec3 uWipe;               // x = wipe NDC x, y = compare 0..1, z = half width (NDC)

// equirect fields collapse to a point at the poles: fade to the pole mean there (no pinch)
float fieldAt(sampler2D tex, vec2 pole, vec3 d) {
  float v = textureBicubic(tex, dirToUv(d), uSomaSize).r;
  float w = smoothstep(0.04, 0.26, length(d.xz));
  return mix(d.y > 0.0 ? pole.x : pole.y, v, w);
}

// Travelling ring wave from a wound centre c (and, entangled, from its antipode).
float rippleAt(float ang, float age) {
  float x = ang - age * 0.85;
  float env = exp(-x * x * 22.0) * exp(-age * 0.95);
  float wave = cos(x * 20.0) * env * 0.032;
  float poke = -exp(-ang * ang * 70.0) * exp(-age * 3.2) * 0.055;
  return wave + poke;
}

// NDC x of an object-space point: the compare wipe is a vertical line on screen.
float ndcX(vec3 p) {
  vec4 c = projectionMatrix * (modelViewMatrix * vec4(p, 1.0));
  return c.x / max(abs(c.w), 1e-5);
}
// 0 = "without" half (left), 1 = "with" half; always 1 when compare is off.
float wipeSide(float x) {
  return mix(1.0, smoothstep(uWipe.x - uWipe.z, uWipe.x + uWipe.z, x), uWipe.y);
}

float displacement(vec3 d, float side, out float field) {
  float gen = mix(uLGen.x, uLGen.y, side);
  float col = mix(uLCol.x, uLCol.y, side);
  float som = mix(uLSom.x, uLSom.y, side);
  float voi = mix(uLVoi.x, uLVoi.y, side);
  // 01 genome: seeded low-frequency noise + gaussian lobes, slowly alive
  float form = snoise(d * 1.1 + uSeed) * 0.085 + snoise(d * 2.3 + uSeed.yzx + uTime * 0.035) * 0.03;
  float lobes = 0.0;
  for (int i = 0; i < LOBES; i++) {
    lobes += uLobes[i].w * exp(uLobeSharp[i] * (dot(d, uLobes[i].xyz) - 1.0));
  }
  float base = uFormAmp * gen * (form + lobes) + uReliefAmp * col * fieldAt(uRelief, uReliefPole, d);
  // 05 soma, entangled: a bump at d pulls a dent at -d (and vice versa)
  field = fieldAt(uSoma, uSomaPole, d) - uEntangle * fieldAt(uSoma, uSomaPole, -d);
  float disp = base + uSomaAmp * som * field;
#ifndef CHEAP_SURFACE
  // wounds (decoherence ripples), mirrored at the antipode by entanglement
  for (int i = 0; i < MAX_WOUNDS; i++) {
    if (i >= uWoundCount) break;
    float ang = acos(clamp(dot(d, uWounds[i].xyz), -1.0, 1.0));
    float age = uWounds[i].w;
    disp += uWoundStrength[i] * (rippleAt(ang, age) + uEntangle * 0.85 * rippleAt(PI - ang, age));
  }
  disp += voi * uShiver * snoise(d * 7.0 + uTime * 2.2);
#endif
  // 07 breathing (audio-scaled), a travelling swell rather than a uniform pump
  disp += voi * uBreath * (0.65 * sin(uBreathPhase - d.y * 1.4) + 0.35 * snoise(d * 1.6 + vec3(uBreathPhase * 0.15)));
  return disp;
}

vec3 surfaceAt(vec3 d, float side, out float field, out float disp) {
  disp = displacement(d, side, field);
  return d * mix(vec3(1.0), uStretch, mix(uLGen.x, uLGen.y, side)) * (1.0 + disp);
}
`;

/* ------------------------------------------------------------------ organism */

export const organismVertex = /* glsl */ `
${COMMON}
${WOUND_UNIFORMS}
${DISPLACE}

varying vec3 vDir;
varying vec3 vViewPos;
varying vec3 vNormalV;
varying float vField;
varying float vDisp;
varying float vSide;
varying float vNdcX;

void main() {
  vec3 d = normalize(position);
  float nx = ndcX(d * uStretch);
  float side = wipeSide(nx);
  float field, disp, f1, q1, f2, q2;
  vec3 P = surfaceAt(d, side, field, disp);

  // finite-difference normal in the tangent plane of the undisplaced sphere
  vec3 up = abs(d.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t = normalize(cross(up, d));
  vec3 b = cross(d, t);
  const float EPS = 0.012;
  vec3 P1 = surfaceAt(normalize(d + t * EPS), side, f1, q1);
  vec3 P2 = surfaceAt(normalize(d + b * EPS), side, f2, q2);
  vec3 N = normalize(cross(P1 - P, P2 - P));
  if (dot(N, d) < 0.0) N = -N;

  vDir = d;
  vField = field;
  vDisp = disp;
  vSide = side;
  vNdcX = nx;
  vec4 mv = modelViewMatrix * vec4(P, 1.0);
  vViewPos = mv.xyz;
  vNormalV = normalize(normalMatrix * N);
  gl_Position = projectionMatrix * mv;
}
`;

export const organismFragment = /* glsl */ `
${COMMON}
${WOUND_UNIFORMS}
#define MAX_NUCLEI ${MAX_NUCLEI}
#define MAX_SCARS ${MAX_SCARS}
#define MAX_LINKS ${MAX_LINKS}
uniform float uTime;
uniform vec3 uSeed;
uniform vec3 uHue;
// artifact slots: textures crossfade A -> B (MP.x), presence fades the artifact in/out (MP.y)
uniform sampler2D uSeedA;
uniform sampler2D uSeedB;
uniform vec4 uSeedSize;
uniform vec2 uSeedMP;
uniform sampler2D uSkinA;
uniform sampler2D uSkinB;
uniform vec4 uSkinSize;
uniform vec2 uSkinMP;
uniform sampler2D uTisA;
uniform sampler2D uTisB;
uniform vec4 uTisSize;
uniform vec2 uTisMP;
uniform sampler2D uMaskA;       // blur-v1 wound mask (linear, v = 1 north)
uniform sampler2D uMaskB;
uniform vec4 uMaskSize;
uniform vec2 uMaskMP;
uniform vec4 uMaskNorm;         // (loA, gainA, loB, gainB): wound-ness = clamp((m - lo) * gain)
uniform sampler2D uRLut;        // Entanglement Shader reflectance LUT (s = phase, REPEAT; t = angle, CLAMP)
uniform sampler2D uTLut;        // Entanglement Shader transmittance LUT
uniform float uRScale;
uniform float uTScale;
uniform float uIrid;
uniform float uThickness;       // nm (engine default 500)
uniform float uThickVar;
uniform float uSomaOn;
uniform float uEmbryo;
uniform float uBeat;
uniform float uCellDetail;
uniform float uDecayTau;
uniform float uAge;             // aging amount (Decoherence slider, live)
uniform int uNucleiCount;
uniform vec4 uNuclei[MAX_NUCLEI];      // xyz dir, w pulse phase
uniform vec3 uNucleiColor[MAX_NUCLEI];
uniform float uNucleiGlow;
uniform int uScarCount;
uniform vec4 uScars[MAX_SCARS];        // wound centres in the mask: xyz dir, w strength
uniform vec2 uLCol;
uniform vec2 uLMor;
uniform vec2 uLDec;
uniform vec2 uLMem;
uniform vec4 uOvA;              // overlays: colony, morphogenesis, decoherence, soma
uniform vec4 uOvB;              // overlays: membrane, voice
uniform vec3 uWipe;
uniform vec2 uGrid;             // Tessa skin texel grid
uniform float uAudio;
uniform vec4 uProbe;            // panel probe: xyz dir, w alpha
uniform float uProbeAnti;       // antipode ring alpha (Soma lens)

varying vec3 vDir;
varying vec3 vViewPos;
varying vec3 vNormalV;
varying float vField;
varying float vDisp;
varying float vSide;
varying float vNdcX;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

// Worley F1/F2 with slowly breathing feature points: living cells.
vec2 cells(vec3 p, float t) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 h = hash33(i + g);
    vec3 o = 0.5 + 0.38 * sin(t + TWO_PI * h);
    vec3 r = g + o - f;
    float dd = dot(r, r);
    if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) { d2 = dd; }
  }
  return sqrt(vec2(d1, d2));
}

// Static Worley F1/F2: craquelure plates.
vec2 plates(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 r = g + 0.1 + 0.8 * hash33(i + g + 17.0) - f;
    float dd = dot(r, r);
    if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) { d2 = dd; }
  }
  return sqrt(vec2(d1, d2));
}

// Derivative bump mapping (surface gradient) — micro relief at almost no cost.
vec3 perturbNormal(vec3 N, vec3 pos, float h, float amt) {
  vec3 dpdx = dFdx(pos);
  vec3 dpdy = dFdy(pos);
  float dhdx = dFdx(h);
  float dhdy = dFdy(h);
  vec3 r1 = cross(dpdy, N);
  vec3 r2 = cross(N, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
  return normalize(abs(det) * N - amt * grad);
}

vec3 slotRGB(sampler2D A, sampler2D B, vec4 size, float m, vec2 uv) {
  vec3 b = textureBicubic(B, uv, size.zw).rgb;
  if (m < 0.999) b = mix(textureBicubic(A, uv, size.xy).rgb, b, m);
  return b;
}

// Thin anti-aliased ring of angular radius r around direction c (+ optional centre dot).
float ringAt(vec3 d, vec3 c, float r, float w) {
  float ang = acos(clamp(dot(d, c), -1.0, 1.0));
  float fw = max(fwidth(ang), 1e-4);
  float ring = 1.0 - smoothstep(w, w + fw * 1.5, abs(ang - r));
  return ring;
}

void main() {
  vec3 d = normalize(vDir);
  vec2 uv = dirToUv(d);
  vec3 Ng = normalize(vNormalV);
  vec3 V = normalize(-vViewPos);
  float side = vSide;
  float aCol = mix(uLCol.x, uLCol.y, side);
  float aMor = mix(uLMor.x, uLMor.y, side);
  float aDec = mix(uLDec.x, uLDec.y, side);
  float aMem = mix(uLMem.x, uLMem.y, side);

  // ---- wound mask (what blur-v1 received): raw level + wound-ness above the whole-body baseline
  vec2 mk = vec2(0.0);
  if (uMaskMP.y > 0.001) {
    float b = textureBicubic(uMaskB, uv, uMaskSize.zw).r;
    mk = vec2(b, clamp((b - uMaskNorm.z) * uMaskNorm.w, 0.0, 1.0));
    if (uMaskMP.x < 0.999) {
      float a = textureBicubic(uMaskA, uv, uMaskSize.xy).r;
      mk = mix(vec2(a, clamp((a - uMaskNorm.x) * uMaskNorm.y, 0.0, 1.0)), mk, uMaskMP.x);
    }
    mk *= uMaskMP.y;
  }
  float mw = mk.y;

  // ---- colour chain: blank -> colony picture (02) -> Tessa skin (03) -> aged tissue (04)
  vec3 blank = mix(vec3(0.3, 0.33, 0.38), uHue, 0.3) * 0.62;
  float ageMix = clamp(uAge * 1.3 - 0.1, 0.0, 1.0);
  float wAge = uTisMP.y * aDec * ageMix;
  float wSkin = uSkinMP.y * aMor;
  float wSeed = uSeedMP.y * aCol;
  vec3 fresh = blank;
  if (uSeedMP.y * max(uLCol.x, uLCol.y) > 0.001 && uSkinMP.y * min(uLMor.x, uLMor.y) < 0.999) {
    fresh = mix(fresh, slotRGB(uSeedA, uSeedB, uSeedSize, uSeedMP.x, uv), wSeed);
  }
  if (uSkinMP.y * max(uLMor.x, uLMor.y) > 0.001) {
    fresh = mix(fresh, slotRGB(uSkinA, uSkinB, uSkinSize, uSkinMP.x, uv), wSkin);
  }
  vec3 tissue = fresh;
  float crack = 0.0;
  if (uTisMP.y * max(uLDec.x, uLDec.y) > 0.001) {
    vec3 t = slotRGB(uTisA, uTisB, uTisSize, uTisMP.x, uv);
    float lumT = luma(t);
    float wear = uAge * (0.55 + 1.2 * mw);
    // patina: colour drains to a warm grey (decohered tissue loses its colour)
    vec3 patina = vec3(lumT) * vec3(1.07, 0.96, 0.82) + 0.015;
    vec3 aged = mix(t, patina, clamp(0.34 * uAge + 0.6 * mw * min(uAge, 1.3), 0.0, 0.95));
    aged *= 1.0 - 0.13 * min(uAge, 1.7);
    // craquelure: a fine crack network, denser + deeper where the mask is high
    vec2 pl = plates(d * (12.0 + 7.0 * mw) + uSeed * 0.53);
    float e = pl.y - pl.x;
    float fwE = fwidth(e);
    float cr = (1.0 - smoothstep(0.0, 0.05 + fwE * 1.2, e)) * smoothstep(0.2, 0.75, wear);
    // erosion pits
    float pit = smoothstep(0.3, 0.72, snoise(d * 24.0 + uSeed.zxy)) * clamp(wear - 0.45, 0.0, 1.0);
    aged *= 1.0 - 0.6 * cr - 0.3 * pit;
    // scars: pale fibrous centre, dark rim where the wound mask rises
    // GLSL pow is undefined for negative bases, even with exponent 2.0.
    // Baseline/unwounded mask values lie below 0.4: square by multiplication.
    float rimArg = (mw - 0.4) / 0.15;
    float rimS = exp(-(rimArg * rimArg));
    float coreS = smoothstep(0.55, 0.95, mw);
    aged = mix(aged, vec3(lumT * 0.45 + 0.22) * vec3(1.0, 0.9, 0.86), coreS * 0.7 * min(uAge, 1.2));
    aged *= 1.0 - 0.62 * rimS * min(uAge, 1.3);
    tissue = mix(fresh, aged, wAge);
    crack = max(cr, pit * 0.5) * wAge;
  }
  float colP = max(uSeedMP.y * aCol, max(uSkinMP.y, uTisMP.y));
  float lum = luma(tissue);
  tissue = mix(vec3(lum), tissue, 0.95) * 0.93 + 0.01;

  // ---- living cellular detail: packed soft cells (bubble domes), faint translucent walls, tiny nuclei
  float cd = uCellDetail * aCol;
  float warp = snoise(d * 2.2 + uSeed * 0.21);
  vec3 cp = d * (8.5 + 2.2 * warp) + uSeed * 0.37;
  cp += 0.22 * vec3(snoise(cp * 0.9 + 3.1), snoise(cp * 0.9 + 7.7), snoise(cp * 0.9 + 1.3));
  vec2 cw = cells(cp, uTime * 0.22);
  float edge = cw.y - cw.x;
  float membrane = 1.0 - smoothstep(0.0, 0.09, edge);
  float core = 1.0 - smoothstep(0.02, 0.11, cw.x);
  float fine = snoise(d * 34.0 + uSeed.zxy);
  vec3 albedo = tissue * (0.86 + 0.28 * (0.5 + 0.5 * warp) * cd);
  albedo *= 1.0 - 0.1 * membrane * cd;
  albedo = mix(albedo, albedo * 1.3 + 0.015, core * 0.22 * cd);
  albedo *= 1.0 + 0.05 * fine * cd;
  float h = ((1.0 - cw.x * cw.x) * 0.6 + fine * 0.04) * cd - crack * 0.9;
  vec3 N = perturbNormal(Ng, vViewPos, h, 0.0026);

  // ---- pending wounds (touched since the last Evolve): flash -> travelling ring (entangled twin) -> fading scar
  float glow = 0.0, scar = 0.0, ring = 0.0;
  for (int i = 0; i < MAX_WOUNDS; i++) {
    if (i >= uWoundCount) break;
    float s = uWoundStrength[i];
    float age = uWounds[i].w;
    float ang = acos(clamp(dot(d, uWounds[i].xyz), -1.0, 1.0));
    float antiAng = PI - ang;
    float flash = exp(-age * 2.6);
    glow += s * (exp(-ang * ang * 110.0) + uEntangle * 0.55 * exp(-antiAng * antiAng * 110.0)) * flash;
    scar += s * exp(-ang * ang * 60.0) * smoothstep(0.1, 0.9, age) * exp(-age / uDecayTau);
    float front = age * 0.85;
    float fade = exp(-age * 1.05);
    float r0 = (ang - front) * 15.0;
    float r1 = (antiAng - front) * 15.0;
    ring += s * fade * (exp(-r0 * r0) + uEntangle * 0.8 * exp(-r1 * r1));
  }
  scar = clamp(scar, 0.0, 1.0);
  float sl = dot(albedo, vec3(0.3333));
  albedo = mix(albedo, vec3(sl) * vec3(0.34, 0.33, 0.37), scar * 0.82);

  // ---- studio lighting (camera-relative): key upper-left, cool fill, rim from behind
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  vec3 Lk = normalize(vec3(-0.55, 0.62, 0.56));
  vec3 Lr = normalize(vec3(0.72, 0.38, -0.58));
  vec3 Lf = normalize(vec3(0.7, -0.3, 0.45));
  vec3 keyC = vec3(1.0, 0.96, 0.92) * 1.7;
  vec3 fillC = vec3(0.5, 0.58, 0.75) * 0.3;
  vec3 rimC = vec3(0.85, 0.9, 1.0) * 1.3;

  float ndlK = dot(N, Lk);
  float diffK = pow(max((ndlK + 0.35) / 1.35, 0.0), 1.25);
  float diffF = max((dot(N, Lf) + 0.3) / 1.3, 0.0);
  // cavity: valleys between lobes/nodules sit in shadow, bulges catch light
  float cavity = clamp(0.78 + vDisp * 2.4, 0.45, 1.1);
  vec3 sssCol = clamp(albedo * albedo * 2.2 + albedo * 0.35, 0.0, 1.5) * vec3(1.0, 0.8, 0.76);
  float terminator = smoothstep(-0.35, 0.1, ndlK) * (1.0 - smoothstep(0.1, 0.6, ndlK));
  vec3 lit = albedo * (keyC * diffK + fillC * diffF + vec3(0.025)) * cavity;
  lit += sssCol * keyC * terminator * 0.28;
  float trans = pow(clamp(dot(V, -normalize(Lr + N * 0.45)), 0.0, 1.0), 3.0);
  lit += sssCol * rimC * trans * 0.5;
  lit += sssCol * membrane * cd * (0.04 + 0.1 * diffK);

  // ---- 06 membrane: thin-film interference from the Entanglement Shader LUTs (engine GLSL contract).
  // θ uses the geometric normal so the linked probe (surface.ts) reports exactly what is painted here.
  float cosTheta = clamp(abs(dot(Ng, V)), 0.0, 1.0);
  float theta = acos(cosTheta);
  float thickness = uThickness * (1.0 + uThickVar * (0.6 * snoise(d * 1.6 + uSeed.yzx + uTime * 0.02) + 0.4 * vField * uSomaOn));
  float D = -2.0 * TWO_PI * thickness * cosTheta;
  const vec3 wavelength = vec3(650.0, 530.0, 470.0);
  vec3 sPh = mod(D / wavelength, TWO_PI) / TWO_PI;
  float t = theta / HALF_PI;
  vec3 Rf = vec3(texture(uRLut, vec2(sPh.r, t)).r, texture(uRLut, vec2(sPh.g, t)).r, texture(uRLut, vec2(sPh.b, t)).r) * uRScale;
  vec3 Tf = vec3(texture(uTLut, vec2(sPh.r, t)).r, texture(uTLut, vec2(sPh.g, t)).r, texture(uTLut, vec2(sPh.b, t)).r) * uTScale;
  float rl = dot(Rf, vec3(0.3333));
  // interference colour: the LUT's channel differences carry the hue — boost them so the shift reads at a glance
  vec3 film = max(vec3(rl) + (Rf - rl) * 3.2, 0.0);
  float irid = uIrid * aMem;

  // transmittance tints the tissue beneath the film
  lit *= mix(vec3(1.0), 0.28 + 1.15 * Tf, irid * 0.6);

  // ---- speculars, soft studio reflections, Fresnel-weighted film (the membrane is what makes the body glossy)
  float gloss = mix(0.4 + 0.6 * irid, 1.0, uEmbryo);
  float F = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);
  vec3 Hk = normalize(Lk + V);
  float nh = max(dot(N, Hk), 0.0);
  float spec = (pow(nh, 110.0) * 1.8 + pow(nh, 16.0) * 0.07) * gloss;
  vec3 R = reflect(-V, N);
  float env = smoothstep(0.3, 0.95, R.y) * 0.75
            + smoothstep(0.62, 1.0, dot(R, normalize(vec3(-0.9, 0.15, 0.4)))) * 0.4
            + smoothstep(0.75, 1.0, dot(R, normalize(vec3(0.95, 0.1, -0.1)))) * 0.25
            + 0.035;
  vec3 specTint = mix(vec3(1.0), film * 1.4, irid * 0.85);
  vec3 col = lit;
  col += specTint * keyC * spec * (0.35 + F);
  col += specTint * env * (0.03 + 0.55 * F) * cavity * gloss;
  // the film itself: visible face-on, strongest towards grazing angles -> colours slide as the organism turns
  col += film * irid * (0.075 + 0.62 * F + 0.25 * (1.0 - cosTheta)) * (0.45 + env);
  float rim = pow(1.0 - NdV, 3.0);
  col += rim * mix(uHue * 0.8 + 0.06, film * 0.85, irid) * 0.32;

  // ---- emissive: colony nuclei glowing beneath the skin
  vec3 nucE = vec3(0.0);
  for (int i = 0; i < MAX_NUCLEI; i++) {
    if (i >= uNucleiCount) break;
    float k = exp((dot(d, uNuclei[i].xyz) - 1.0) * 26.0);
    float pulse = 0.62 + 0.38 * sin(uTime * 1.35 + uNuclei[i].w);
    nucE += uNucleiColor[i] * k * pulse;
  }
  col += nucE * uNucleiGlow * aCol;

  // ---- emissive: pending wounds
  vec3 hot = mix(vec3(1.0, 0.93, 0.86), uHue + 0.4, 0.25);
  col += hot * glow * 3.2;
  col += mix(uHue * 1.3 + 0.18, film * 1.2, irid * 0.5) * ring * 0.85;

  // ================================================================ Chrono Lens overlays (on the "with" half)
  // 02 colony: nuclei markers + the cell walls between them (spherical Voronoi of the graph-v1 nuclei)
  if (uOvA.x > 0.001 && uNucleiCount > 0) {
    float b1 = -2.0, b2 = -2.0;
    int i1 = 0;
    for (int i = 0; i < MAX_NUCLEI; i++) {
      if (i >= uNucleiCount) break;
      float k = dot(d, uNuclei[i].xyz);
      if (k > b1) { b2 = b1; b1 = k; i1 = i; } else if (k > b2) { b2 = k; }
    }
    float e = b1 - b2;
    float wall = 1.0 - smoothstep(0.0, fwidth(e) * 1.6 + 1e-4, e);
    float angN = acos(clamp(b1, -1.0, 1.0));
    float fwA = max(fwidth(angN), 1e-4);
    float marker = (1.0 - smoothstep(0.012, 0.012 + fwA * 1.5, abs(angN - 0.075))) + (1.0 - smoothstep(0.02, 0.02 + fwA * 1.5, angN));
    vec3 nc = uNucleiColor[i1] * 1.6 + 0.25;
    col += nc * (wall * 0.75 + marker * 1.3) * uOvA.x * side;
  }
  // 03 morphogenesis: Tessa's texel grid
  if (uOvA.y > 0.001) {
    vec2 g = uv * uGrid;
    float gu2 = fract(uv.x + 0.5) * uGrid.x;
    vec2 fw = vec2(min(fwidth(g.x), fwidth(gu2)), fwidth(g.y));
    vec2 dist = abs(fract(g - 0.5) - 0.5) / max(fw, vec2(1e-5));
    float lu = (1.0 - smoothstep(0.5, 1.5, dist.x)) * smoothstep(0.08, 0.3, length(d.xz));
    float lv = 1.0 - smoothstep(0.5, 1.5, dist.y);
    float line = max(lu, lv);
    col = mix(col, vec3(0.86, 0.92, 1.0) * 1.1, line * 0.6 * uOvA.y * side);
  }
  // 04 decoherence: wound-mask heat glowing on the surface + a ring at each wound centre
  if (uOvA.z > 0.001) {
    float m = mk.x;
    vec3 heat = mix(vec3(0.55, 0.08, 0.03), vec3(1.0, 0.45, 0.1), smoothstep(0.25, 0.65, m));
    heat = mix(heat, vec3(1.0, 0.9, 0.62), smoothstep(0.7, 1.0, m));
    float hk = 0.16 * m + 1.5 * mw * mw;
    float rr = 0.0;
    for (int i = 0; i < MAX_SCARS; i++) {
      if (i >= uScarCount) break;
      rr += ringAt(d, uScars[i].xyz, 0.085, 0.006) + (1.0 - smoothstep(0.0, 0.022, acos(clamp(dot(d, uScars[i].xyz), -1.0, 1.0))));
    }
    col += (heat * hk + vec3(1.0, 0.8, 0.55) * rr * 1.4) * uOvA.z * side;
  }
  // 05 soma: iso-contours of the displacement field (warm = outward, cool = inward)
  if (uOvA.w > 0.001) {
    float f = vField;
    float x = f / 0.16;
    float fwx = max(fwidth(x), 1e-4);
    float dl = abs(x - floor(x + 0.5)) / fwx;
    float line = 1.0 - smoothstep(0.55, 1.45, dl);
    vec3 warm = vec3(1.0, 0.55, 0.22);
    vec3 cool = vec3(0.28, 0.62, 1.0);
    vec3 lc = f > 0.0 ? warm : cool;
    float strength = 0.35 + 0.9 * smoothstep(0.0, 0.9, abs(f));
    vec3 fill = (warm * max(f, 0.0) + cool * max(-f, 0.0)) * 0.22;
    col += (lc * line * strength * 1.25 + fill) * uOvA.w * side;
  }
  // 06 membrane: thin-film angle bands — iso-lines of θ tinted by the LUT phase colour at that angle
  if (uOvB.x > 0.001) {
    float bands = t * 12.0;
    float fwb = max(fwidth(bands), 1e-4);
    float dl = abs(bands - floor(bands + 0.5)) / fwb;
    float line = (1.0 - smoothstep(0.6, 1.6, dl)) * (1.0 - smoothstep(0.35, 0.8, fwb));
    vec3 bandCol = film / (dot(film, vec3(0.3333)) + 0.04);
    bandCol = clamp(bandCol, 0.0, 3.0) * 0.55 + 0.1;
    col += bandCol * line * 1.3 * uOvB.x * side;
  }
  // 07 voice: an equatorial ring displaced by the song
  if (uOvB.y > 0.001) {
    float phi = atan(d.z, -d.x);
    float wob = uAudio * (0.06 * sin(phi * 6.0 + uTime * 3.1) + 0.035 * sin(phi * 11.0 - uTime * 4.7))
              + 0.014 * sin(phi * 3.0 + uTime * 0.9);
    float lat = d.y - wob;
    float fwl = max(fwidth(lat), 1e-4);
    float band = 1.0 - smoothstep(0.004, 0.004 + fwl * 1.5, abs(lat));
    col += (uHue * 0.5 + vec3(0.55, 0.62, 0.7)) * band * (0.9 + 1.4 * uAudio) * uOvB.y * side;
  }

  // ---- linked probe from the panel: a ring where the hovered preview pixel lives (+ its antipode for Soma)
  if (uProbe.w > 0.001) {
    float pr = ringAt(d, uProbe.xyz, 0.075, 0.007) + (1.0 - smoothstep(0.0, 0.016, acos(clamp(dot(d, uProbe.xyz), -1.0, 1.0))));
    col += vec3(0.95, 0.97, 1.0) * pr * 1.6 * uProbe.w;
    if (uProbeAnti > 0.001) {
      float pa = ringAt(d, -uProbe.xyz, 0.075, 0.007);
      col += vec3(0.4, 0.72, 1.0) * pa * 1.4 * uProbeAnti;
    }
  }

  // ---- compare: a thin glowing terminator between "without" (left) and "with" (right)
  if (uWipe.y > 0.001) {
    float fwn = max(fwidth(vNdcX), 1e-5);
    float dx = (vNdcX - uWipe.x) / fwn;
    float line = exp(-dx * dx * 0.35) + 0.25 * exp(-dx * dx * 0.03);
    col += vec3(0.82, 0.9, 1.0) * line * 1.1 * uWipe.y;
  }

  // ---- embryo: a translucent seed with a soft inner glow, gently pulsing
  float fr = pow(1.0 - NdV, 2.4);
  vec3 eb = mix(vec3(0.52, 0.66, 0.92), uHue, 0.3);
  float swirl = 0.5 + 0.5 * snoise(d * 2.4 + vec3(0.0, uTime * 0.06, uTime * 0.03));
  float inner = pow(NdV, 2.2);
  vec3 emb = eb * (0.02 + 1.15 * fr);
  emb += eb * inner * (0.05 + 0.13 * uBeat) * (0.65 + 0.7 * swirl);
  emb += vec3(0.95, 0.97, 1.0) * spec * 0.45 + env * F * 0.3;
  emb += nucE * uNucleiGlow * 0.6;
  emb = mix(emb, emb + col * 0.55, colP);
  col = mix(col, emb, uEmbryo);
  float alpha = mix(1.0, clamp(0.1 + 0.8 * fr + 0.18 * inner * (0.5 + uBeat) + colP * 0.35, 0.0, 1.0), uEmbryo);

  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* ------------------------------------------------------------ lens overlays */

/** 01 Genesis overlay: the 256 genome bits as sparks on the surface (1 = bright, 0 = dim). */
export const sparksVertex = /* glsl */ `
#define CHEAP_SURFACE
${COMMON}
${WOUND_UNIFORMS}
${DISPLACE}
attribute float aBit;
attribute float aIdx;
uniform float uPxPerUnit;
uniform float uSparkAlpha;
varying float vA;
varying float vBit;
void main() {
  vec3 d = normalize(position);
  float s = wipeSide(ndcX(d * uStretch));
  float f, q;
  vec3 P = surfaceAt(d, s, f, q) * 1.012;
  vec4 mv = modelViewMatrix * vec4(P, 1.0);
  float dist = max(-mv.z, 0.05);
  float tw = 0.6 + 0.4 * sin(uTime * 2.2 + aIdx * 0.37);
  float scan = fract(uTime * 0.085) * 1.25 - aIdx / 256.0;
  scan = exp(-scan * scan * 900.0);
  gl_PointSize = clamp((aBit > 0.5 ? 0.046 : 0.024) * (1.0 + 0.9 * scan) * uPxPerUnit / dist, 1.5, 48.0);
  vA = uSparkAlpha * s * (aBit > 0.5 ? 0.8 * tw + 0.9 * scan : 0.16 + 0.4 * scan);
  vBit = aBit;
  gl_Position = projectionMatrix * mv;
}
`;

export const sparksFragment = /* glsl */ `
uniform vec3 uHue;
varying float vA;
varying float vBit;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c) * 4.0;
  float a = (exp(-r2 * 7.0) * 0.75 + exp(-r2 * 40.0)) * vA;
  if (a < 0.003) discard;
  vec3 on = mix(vec3(1.0, 0.9, 0.7), uHue + 0.35, 0.3) * 1.7;
  vec3 off = vec3(0.42, 0.55, 0.85);
  gl_FragColor = vec4(vBit > 0.5 ? on : off, a);
  #include <colorspace_fragment>
}
`;

/** 05 Soma overlay: entangled links — chords through the interior from each bump to the dent opposite it. */
export const linksVertex = /* glsl */ `
#define CHEAP_SURFACE
${COMMON}
${WOUND_UNIFORMS}
${DISPLACE}
#define MAX_LINKS ${MAX_LINKS}
attribute float aLink;
attribute float aT;
uniform vec4 uLinks[MAX_LINKS];   // xyz bump direction, w weight
uniform int uLinkCount;
uniform float uLinkAlpha;
varying float vT;
varying float vA;
varying float vPulse;
void main() {
  int i = int(aLink + 0.5);
  vec3 d0 = normalize(uLinks[i].xyz);
  float f, q;
  vec3 P0 = surfaceAt(d0, wipeSide(ndcX(d0 * uStretch)), f, q);
  vec3 P1 = surfaceAt(-d0, wipeSide(ndcX(-d0 * uStretch)), f, q);
  vec3 ref = abs(d0.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 e1 = normalize(cross(d0, ref));
  vec3 e2 = cross(d0, e1);
  float a = aLink * 2.39996;
  vec3 C = 0.5 * (P0 + P1) + (cos(a) * e1 + sin(a) * e2) * 0.34;
  float s = 1.0 - aT;
  vec3 P = s * s * P0 + 2.0 * s * aT * C + aT * aT * P1;
  vec4 mv = modelViewMatrix * vec4(P, 1.0);
  gl_Position = projectionMatrix * mv;
  float live = i < uLinkCount ? 1.0 : 0.0;
  vA = uLinkAlpha * uLinks[i].w * live * wipeSide(ndcX(P));
  vT = aT;
  float head = fract(uTime * 0.26 + float(i) * 0.37) * 1.3 - 0.15;
  float dh = (aT - head) * 8.0;
  vPulse = exp(-dh * dh);
}
`;

export const linksFragment = /* glsl */ `
varying float vT;
varying float vA;
varying float vPulse;
void main() {
  vec3 warm = vec3(1.0, 0.6, 0.28);
  vec3 cool = vec3(0.32, 0.68, 1.0);
  vec3 c = mix(warm, cool, smoothstep(0.08, 0.92, vT));
  float a = vA * (0.34 + 1.7 * vPulse);
  if (a < 0.002) discard;
  gl_FragColor = vec4(c * (0.9 + 1.6 * vPulse), a);
  #include <colorspace_fragment>
}
`;

/** Link end nodes: a warm node on each bump, a cool node on the dent opposite (dimmer when behind the body). */
export const linkNodesVertex = /* glsl */ `
#define CHEAP_SURFACE
${COMMON}
${WOUND_UNIFORMS}
${DISPLACE}
#define MAX_LINKS ${MAX_LINKS}
attribute float aLink;
attribute float aEnd;
uniform vec4 uLinks[MAX_LINKS];
uniform int uLinkCount;
uniform float uLinkAlpha;
uniform float uPxPerUnit;
varying float vA;
varying float vEnd;
void main() {
  int i = int(aLink + 0.5);
  vec3 d0 = normalize(uLinks[i].xyz) * (aEnd > 0.5 ? -1.0 : 1.0);
  float f, q;
  float s = wipeSide(ndcX(d0 * uStretch));
  vec3 P = surfaceAt(d0, s, f, q) * 1.006;
  vec4 mv = modelViewMatrix * vec4(P, 1.0);
  vec3 nv = normalize(normalMatrix * d0);
  float front = smoothstep(-0.1, 0.15, dot(nv, normalize(-mv.xyz)));
  float dist = max(-mv.z, 0.05);
  gl_PointSize = clamp(0.1 * uPxPerUnit / dist, 3.0, 72.0);
  vA = uLinkAlpha * uLinks[i].w * (i < uLinkCount ? 1.0 : 0.0) * mix(0.35, 1.0, front) * s;
  vEnd = aEnd;
  gl_Position = projectionMatrix * mv;
}
`;

export const linkNodesFragment = /* glsl */ `
varying float vA;
varying float vEnd;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  float ringArg = (r - 0.62) * 9.0;
  float ring = exp(-(ringArg * ringArg));
  float dot_ = exp(-r * r * 22.0);
  float a = (ring * 0.9 + dot_) * vA;
  if (a < 0.003) discard;
  vec3 c0 = vEnd > 0.5 ? vec3(0.35, 0.7, 1.0) : vec3(1.0, 0.62, 0.3);
  gl_FragColor = vec4(c0 * 1.8, a);
  #include <colorspace_fragment>
}
`;

/** 08 Echo: translucent ghost shells of the body pulsing outward; odd shells are darker (inverted taps). */
export const shellsVertex = /* glsl */ `
#define CHEAP_SURFACE
${COMMON}
${WOUND_UNIFORMS}
${DISPLACE}
attribute float aShell;
uniform float uShellCount;
uniform float uGhost;
uniform vec2 uLEcho;
uniform float uShellOv;
uniform float uShellRate;
varying float vA;
varying float vDark;
varying vec3 vN;
varying vec3 vV;
void main() {
  vec3 d = normalize(position);
  float s = wipeSide(ndcX(d * uStretch));
  float f, q;
  vec3 P = surfaceAt(d, s, f, q);
  float n = max(uShellCount, 1.0);
  float ph = fract(uTime * uShellRate + aShell / n);
  P *= 1.02 + ph * (0.12 + 0.42 * uShellOv);
  vec4 mv = modelViewMatrix * vec4(P, 1.0);
  vN = normalize(normalMatrix * d);
  vV = normalize(-mv.xyz);
  float env = smoothstep(0.0, 0.12, ph) * pow(1.0 - ph, 1.5);
  vA = env * step(aShell + 0.5, n) * max(uGhost * mix(uLEcho.x, uLEcho.y, s), uShellOv * s);
  vDark = mod(aShell, 2.0);
  gl_Position = projectionMatrix * mv;
}
`;

export const shellsFragment = /* glsl */ `
uniform vec3 uHue;
uniform float uShellOv;
varying float vA;
varying float vDark;
varying vec3 vN;
varying vec3 vV;
void main() {
  // Normalized dot products can round slightly past 1 on the GPU.
  // A negative Fresnel base makes the fractional power invalid and poisons bloom.
  float ndv = clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
  float rim = pow(1.0 - ndv, 2.2);
  float line = pow(1.0 - ndv, 8.0);
  float a = vA * (0.04 + 0.5 * rim + uShellOv * 0.9 * line);
  bool dark = vDark > 0.5;
  vec3 c = dark ? vec3(0.004, 0.006, 0.014) : mix(uHue, vec3(0.8, 0.88, 1.0), 0.62) * 1.3;
  a *= dark ? 0.85 : 1.0;
  if (a < 0.002) discard;
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}
`;

/* ------------------------------------------------------------------ backdrop */

export const backdropVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.9999, 1.0);
}
`;

export const backdropFragment = /* glsl */ `
uniform vec2 uRes;
uniform vec3 uHue;
uniform float uGlow;
uniform vec3 uBase;
uniform vec3 uCentre;
varying vec2 vUv;
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / max(uRes.y, 1.0), 1.0);
  float r = length(p);
  vec3 col = mix(uCentre, uBase, smoothstep(0.0, 0.9, r));
  col += uHue * uGlow * exp(-r * r * 4.0);
  col *= mix(1.0, 0.72, smoothstep(0.6, 1.3, r));
  // dither against banding in the deep blacks
  col *= 1.0 + (hash12(gl_FragCoord.xy) - 0.5) * 0.09;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/* ---------------------------------------------------------------------- dust */

export const dustVertex = /* glsl */ `
attribute vec4 aSeed;
attribute float aSize;
uniform float uTime;
uniform float uPxPerUnit;
uniform float uFocus;
uniform float uDrift;
varying float vAlpha;
varying float vSoft;
void main() {
  vec3 p = position;
  float t = uTime;
  p += vec3(
    sin(t * (0.05 + 0.06 * aSeed.x) + aSeed.y * 6.283),
    sin(t * (0.04 + 0.05 * aSeed.z) + aSeed.w * 6.283),
    cos(t * (0.045 + 0.05 * aSeed.y) + aSeed.x * 6.283)
  ) * (0.15 + 0.3 * aSeed.z) * uDrift;
  p.y += sin(t * 0.03 + aSeed.w * 20.0) * 0.2 * uDrift;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dist = max(-mv.z, 0.05);
  float coc = clamp(abs(dist - uFocus) / uFocus, 0.0, 1.2);
  float px = aSize * uPxPerUnit / dist;
  gl_PointSize = clamp(px * (1.0 + coc * 7.0), 1.0, 90.0);
  float twinkle = 0.7 + 0.3 * sin(t * (0.4 + aSeed.x) + aSeed.y * 40.0);
  // spores catch the key light (upper-left of frame), the rest of the room stays dark
  vec2 sp = mv.xy / dist;
  float lit = smoothstep(-0.25, 0.3, dot(sp, vec2(-0.6, 0.8)));
  vAlpha = (0.22 + 0.45 * aSeed.w) * twinkle * (0.25 + 0.75 * lit) / (1.0 + coc * coc * 18.0) * smoothstep(0.4, 1.4, dist);
  vSoft = coc;
  gl_Position = projectionMatrix * mv;
}
`;

export const dustFragment = /* glsl */ `
uniform vec3 uTint;
uniform float uAlpha;
varying float vAlpha;
varying float vSoft;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  float core = exp(-r * r * 7.0);
  float disc = (1.0 - smoothstep(0.7, 1.0, r)) * (0.6 + 0.4 * r);
  float a = mix(core, disc * 0.5, clamp(vSoft * 2.0, 0.0, 1.0)) * vAlpha * uAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uTint, a);
  #include <colorspace_fragment>
}
`;

/* -------------------------------------------------------------------- nuclei */

export const nucleiVertex = /* glsl */ `
attribute vec3 aColor;
attribute vec2 aInfo; // x = pulse phase, y = strength
uniform float uTime;
uniform float uPxPerUnit;
uniform float uAlpha;
varying vec3 vColor;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float pulse = 0.72 + 0.28 * sin(uTime * 1.6 + aInfo.x);
  float dist = max(-mv.z, 0.05);
  gl_PointSize = clamp((0.34 + 0.3 * aInfo.y) * pulse * uPxPerUnit / dist, 1.0, 256.0);
  vColor = aColor;
  vA = uAlpha * pulse;
  gl_Position = projectionMatrix * mv;
}
`;

export const nucleiFragment = /* glsl */ `
varying vec3 vColor;
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c) * 4.0;
  float a = (exp(-r2 * 5.0) * 0.8 + exp(-r2 * 38.0) * 0.9) * vA;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * 2.2 + 0.15, a);
  #include <colorspace_fragment>
}
`;
