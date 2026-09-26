/**
 * GLSL for the organism, its stage backdrop, suspended dust and colony nuclei. OWNER: viewport agent.
 *
 * Conventions:
 *  - Displacement and colour are functions of the undisplaced unit direction d (object space), so there are no
 *    seams/poles artefacts; d -> uv uses three's SphereGeometry mapping (u = longitude, v = latitude, v=1 north).
 *  - Membrane iridescence follows the Entanglement Shader GLSL contract exactly (see docs/BRIEF.md §3).
 */

export const MAX_WOUNDS = 16;
export const MAX_NUCLEI = 12;

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

// Ashima 3D simplex noise (MIT).
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
uniform float uEntangle;
`;

/* ------------------------------------------------------------------ organism */

export const organismVertex = /* glsl */ `
${COMMON}
${WOUND_UNIFORMS}
#define LOBES 5
uniform float uTime;
uniform sampler2D uSoma;          // centred displacement field [-1, 1] (blur-core-v1), v = 1 north
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

varying vec3 vDir;
varying vec3 vViewPos;
varying vec3 vNormalV;
varying float vSoma;
varying float vAnti;
varying float vDisp;

// equirect fields collapse to a point at the poles: fade to the pole mean there (no pinch)
float fieldAt(sampler2D tex, vec2 pole, vec3 d) {
  float v = textureBicubic(tex, dirToUv(d), uSomaSize).r;
  float w = smoothstep(0.04, 0.26, length(d.xz));
  return mix(d.y > 0.0 ? pole.x : pole.y, v, w);
}
float somaAt(vec3 d) { return fieldAt(uSoma, uSomaPole, d); }

// Travelling ring wave from a wound centre c (and, entangled, from its antipode).
float rippleAt(float ang, float age) {
  float x = ang - age * 0.85;
  float env = exp(-x * x * 22.0) * exp(-age * 0.95);
  float wave = cos(x * 20.0) * env * 0.032;
  float poke = -exp(-ang * ang * 70.0) * exp(-age * 3.2) * 0.055;
  return wave + poke;
}

float displacement(vec3 d, out float soma, out float anti) {
  // organic base form: genome-seeded low-frequency noise lobes, slowly alive
  float form = snoise(d * 1.1 + uSeed) * 0.085 + snoise(d * 2.3 + uSeed.yzx + uTime * 0.035) * 0.03;
  float lobes = 0.0;
  for (int i = 0; i < LOBES; i++) {
    lobes += uLobes[i].w * exp(uLobeSharp[i] * (dot(d, uLobes[i].xyz) - 1.0));
  }
  float base = uFormAmp * (form + lobes) + uReliefAmp * fieldAt(uRelief, uReliefPole, d);

  // soma + entangled antipodal coupling: the field at -d warps d non-locally
  soma = somaAt(d);
  anti = somaAt(-d);
  float s = uSomaAmp * (soma + uEntangle * anti);

  // wounds (decoherence ripples), mirrored at the antipode by entanglement
  float rip = 0.0;
  for (int i = 0; i < MAX_WOUNDS; i++) {
    if (i >= uWoundCount) break;
    float ang = acos(clamp(dot(d, uWounds[i].xyz), -1.0, 1.0));
    float age = uWounds[i].w;
    rip += uWoundStrength[i] * (rippleAt(ang, age) + uEntangle * 0.85 * rippleAt(PI - ang, age));
  }

  // breathing (audio-scaled), a travelling swell rather than a uniform pump
  float br = uBreath * (0.65 * sin(uBreathPhase - d.y * 1.4) + 0.35 * snoise(d * 1.6 + vec3(uBreathPhase * 0.15)));
  float sh = uShiver * snoise(d * 7.0 + uTime * 2.2);
  return base + s + rip + br + sh;
}

vec3 surfaceAt(vec3 d, out float soma, out float anti, out float disp) {
  disp = displacement(d, soma, anti);
  return d * uStretch * (1.0 + disp);
}

void main() {
  vec3 d = normalize(position);
  float soma, anti, disp, s1, a1, d1, s2, a2, d2;
  vec3 P = surfaceAt(d, soma, anti, disp);

  // finite-difference normal in the tangent plane of the undisplaced sphere
  vec3 up = abs(d.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t = normalize(cross(up, d));
  vec3 b = cross(d, t);
  const float EPS = 0.012;
  vec3 P1 = surfaceAt(normalize(d + t * EPS), s1, a1, d1);
  vec3 P2 = surfaceAt(normalize(d + b * EPS), s2, a2, d2);
  vec3 N = normalize(cross(P1 - P, P2 - P));
  if (dot(N, d) < 0.0) N = -N;

  vDir = d;
  vSoma = soma;
  vAnti = anti;
  vDisp = disp;
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
uniform float uTime;
uniform sampler2D uColA;
uniform sampler2D uColB;
uniform vec2 uColASize;
uniform vec2 uColBSize;
uniform float uColMix;
uniform float uHasCol;
uniform sampler2D uRLut;      // Entanglement Shader reflectance LUT (s = phase, REPEAT; t = angle, CLAMP)
uniform sampler2D uTLut;      // Entanglement Shader transmittance LUT
uniform float uRScale;
uniform float uTScale;
uniform float uIrid;
uniform float uThickness;     // nm (engine default 500)
uniform float uThickVar;
uniform float uEmbryo;
uniform vec3 uHue;
uniform vec3 uSeed;
uniform float uCellDetail;
uniform float uDecayTau;
uniform float uSomaAmp;
uniform int uNucleiCount;
uniform vec4 uNuclei[MAX_NUCLEI];      // xyz dir, w pulse phase
uniform vec3 uNucleiColor[MAX_NUCLEI];
uniform float uNucleiGlow;

varying vec3 vDir;
varying vec3 vViewPos;
varying vec3 vNormalV;
varying float vSoma;
varying float vAnti;
varying float vDisp;

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

void main() {
  vec3 d = normalize(vDir);
  vec2 uv = dirToUv(d);
  vec3 N = normalize(vNormalV);
  vec3 V = normalize(-vViewPos);

  // ---- tissue colour: Blur tissue > Tessa skin > colony seed (crossfaded), smooth bicubic upscaling
  vec3 cA = textureBicubic(uColA, uv, uColASize).rgb;
  vec3 cB = textureBicubic(uColB, uv, uColBSize).rgb;
  vec3 tissue = mix(cA, cB, uColMix);
  vec3 embryoTint = mix(vec3(0.42, 0.5, 0.62), uHue, 0.4);
  tissue = mix(embryoTint * 0.45, tissue, uHasCol);
  float lum = dot(tissue, vec3(0.2126, 0.7152, 0.0722));
  tissue = mix(vec3(lum), tissue, 0.86) * 0.92 + 0.012;

  // ---- living cellular detail: packed soft cells (bubble domes), faint translucent walls, tiny nuclei
  float cd = uCellDetail;
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
  float h = ((1.0 - cw.x * cw.x) * 0.6 + fine * 0.04) * cd;
  N = perturbNormal(N, vViewPos, h, 0.0026);

  // ---- wounds: bright flash -> travelling ring (entangled twin at the antipode) -> decoherence scar
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
  float cavity = clamp(0.8 + vDisp * 2.6, 0.5, 1.08);
  vec3 sssCol = clamp(albedo * albedo * 2.2 + albedo * 0.35, 0.0, 1.5) * vec3(1.0, 0.8, 0.76);
  float terminator = smoothstep(-0.35, 0.1, ndlK) * (1.0 - smoothstep(0.1, 0.6, ndlK));
  vec3 lit = albedo * (keyC * diffK + fillC * diffF + vec3(0.025)) * cavity;
  lit += sssCol * keyC * terminator * 0.28;
  float trans = pow(clamp(dot(V, -normalize(Lr + N * 0.45)), 0.0, 1.0), 3.0);
  lit += sssCol * rimC * trans * 0.5;
  lit += sssCol * membrane * cd * (0.04 + 0.1 * diffK);

  // ---- membrane: thin-film iridescence from the Entanglement Shader LUTs (engine GLSL contract)
  float cosTheta = abs(dot(N, V));
  float theta = acos(clamp(cosTheta, 0.0, 1.0));
  float thickness = uThickness * (1.0 + uThickVar * (0.55 * snoise(d * 1.6 + uSeed.yzx + uTime * 0.02) + 0.45 * (vSoma + uEntangle * vAnti) * step(0.0001, uSomaAmp)));
  float D = -2.0 * TWO_PI * thickness * cosTheta;
  const vec3 wavelength = vec3(650.0, 530.0, 470.0);
  float s0 = mod(D / wavelength.r, TWO_PI) / TWO_PI;
  float s1 = mod(D / wavelength.g, TWO_PI) / TWO_PI;
  float s2 = mod(D / wavelength.b, TWO_PI) / TWO_PI;
  float t = theta / HALF_PI;
  vec3 Rf = vec3(texture(uRLut, vec2(s0, t)).r, texture(uRLut, vec2(s1, t)).r, texture(uRLut, vec2(s2, t)).r) * uRScale;
  vec3 Tf = vec3(texture(uTLut, vec2(s0, t)).r, texture(uTLut, vec2(s1, t)).r, texture(uTLut, vec2(s2, t)).r) * uTScale;
  float rl = dot(Rf, vec3(0.3333));
  vec3 film = max(mix(vec3(rl), Rf, 1.8), 0.0);

  // transmittance tints the tissue beneath the film
  lit *= mix(vec3(1.0), 0.3 + 1.05 * Tf, uIrid * 0.6);

  // ---- speculars, soft studio reflections, Fresnel-weighted film
  float F = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);
  vec3 Hk = normalize(Lk + V);
  float nh = max(dot(N, Hk), 0.0);
  float spec = pow(nh, 110.0) * 1.8 + pow(nh, 16.0) * 0.07;
  vec3 R = reflect(-V, N);
  float env = smoothstep(0.3, 0.95, R.y) * 0.75
            + smoothstep(0.62, 1.0, dot(R, normalize(vec3(-0.9, 0.15, 0.4)))) * 0.4
            + smoothstep(0.75, 1.0, dot(R, normalize(vec3(0.95, 0.1, -0.1)))) * 0.25
            + 0.035;
  vec3 specTint = mix(vec3(1.0), film * 1.35, uIrid * 0.85);
  vec3 col = lit;
  col += specTint * keyC * spec * (0.35 + F);
  col += specTint * env * (0.03 + 0.55 * F) * cavity;
  col += film * uIrid * (0.012 + 0.5 * F) * (0.45 + env);
  float rim = pow(1.0 - NdV, 3.0);
  col += rim * mix(uHue * 0.8 + 0.06, film * 0.8, uIrid) * 0.32;

  // ---- emissive: colony nuclei glowing beneath the skin
  vec3 nucE = vec3(0.0);
  for (int i = 0; i < MAX_NUCLEI; i++) {
    if (i >= uNucleiCount) break;
    float k = exp((dot(d, uNuclei[i].xyz) - 1.0) * 26.0);
    float pulse = 0.62 + 0.38 * sin(uTime * 1.35 + uNuclei[i].w);
    nucE += uNucleiColor[i] * k * pulse;
  }
  col += nucE * uNucleiGlow;

  // ---- emissive: wounds
  vec3 hot = mix(vec3(1.0, 0.93, 0.86), uHue + 0.4, 0.25);
  col += hot * glow * 3.2;
  col += mix(uHue * 1.3 + 0.18, film * 1.2, uIrid * 0.5) * ring * 0.85;

  // ---- embryo: translucent pulsing membrane
  float fr = pow(1.0 - NdV, 2.2);
  vec3 eb = mix(vec3(0.55, 0.68, 0.9), uHue, 0.35);
  float beat = 0.5 + 0.5 * sin(uTime * 2.1);
  vec3 emb = eb * (0.035 + 1.25 * fr) + eb * 0.07 * beat * (1.0 - fr);
  emb += spec * vec3(0.9) * 0.6 + env * F * 0.35;
  emb += nucE * uNucleiGlow * 0.6;
  emb = mix(emb, emb + col * 0.55, uHasCol);
  col = mix(col, emb, uEmbryo);
  float alpha = mix(1.0, clamp(0.14 + 0.82 * fr + uHasCol * 0.35, 0.0, 1.0), uEmbryo);

  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
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
varying float vAlpha;
varying float vSoft;
void main() {
  vec3 p = position;
  float t = uTime;
  p += vec3(
    sin(t * (0.05 + 0.06 * aSeed.x) + aSeed.y * 6.283),
    sin(t * (0.04 + 0.05 * aSeed.z) + aSeed.w * 6.283),
    cos(t * (0.045 + 0.05 * aSeed.y) + aSeed.x * 6.283)
  ) * (0.15 + 0.3 * aSeed.z);
  p.y += sin(t * 0.03 + aSeed.w * 20.0) * 0.2;
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
varying float vAlpha;
varying float vSoft;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  float core = exp(-r * r * 7.0);
  float disc = (1.0 - smoothstep(0.7, 1.0, r)) * (0.6 + 0.4 * r);
  float a = mix(core, disc * 0.5, clamp(vSoft * 2.0, 0.0, 1.0)) * vAlpha;
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
