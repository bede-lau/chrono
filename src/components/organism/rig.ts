/**
 * OrganismRig — imperative, React-free state machine behind the organism.
 * Owns uniforms/textures, turns artifacts into smooth ~800 ms transitions, and tracks wounds.
 * OWNER: viewport agent.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  FrontSide,
  RepeatWrapping,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  type Texture,
  type WebGLRenderer,
} from "three";
import type { Controls, Lut, Specimen, Wound } from "@/lib/chain/types";
import {
  LOBES,
  MAX_NUCLEI as MAX_NUCLEI_ART,
  SOMA_RES,
  colonyRelief,
  hslToRgb,
  lutStats,
  lutValid,
  morphologyFromGenome,
  nucleiFromColony,
  poleMeans,
  somaField,
  specimenHue,
  srgbToLinear,
  uvToDir,
  type Morphology,
  type Vec3,
} from "./artifacts";
import { MAX_NUCLEI, MAX_WOUNDS, nucleiFragment, nucleiVertex, organismFragment, organismVertex } from "./shaders";
import { ScalarTexture, floatLinearSupported, loadImagePixels, loadImageTexture, solidTexture, textureSize } from "./textures";

const SOMA_AMP = 0.12;
const RELIEF_AMP = 0.085;
const RIPPLE_LIFE = 5; // s
const TRANSITION = 0.8; // s (texture crossfade)
const TAU_FAST = 0.22; // exponential approach time constant (~95% in 0.66 s)
const TAU_SLOW = 0.32;

const approach = (cur: number, target: number, dt: number, tau: number) => cur + (target - cur) * (1 - Math.exp(-dt / tau));
const smooth = (x: number) => x * x * (3 - 2 * x);

type StoreSlice = { controls: Controls; audioLevel: number; pendingWounds: Wound[] };

/** A SOMA_RES² displacement field that lerps (CPU) towards its target, including its pole values. */
class FieldAnim {
  readonly tex: ScalarTexture;
  readonly target = new Float32Array(SOMA_RES * SOMA_RES);
  readonly pole = new Vector2();
  private readonly poleTarget = new Vector2();
  private settled = true;

  constructor(useFloat: boolean) {
    this.tex = new ScalarTexture(SOMA_RES, SOMA_RES, useFloat, RepeatWrapping, 0);
  }

  setTarget(field: Float32Array | null) {
    if (field) this.target.set(field);
    else this.target.fill(0);
    const [n, s] = poleMeans(this.target);
    this.poleTarget.set(n, s);
    this.settled = false;
  }

  step(dt: number, tau: number) {
    if (this.settled) return;
    const k = 1 - Math.exp(-dt / tau);
    const cur = this.tex.values;
    let maxD = 0;
    for (let i = 0; i < cur.length; i++) {
      const d = this.target[i] - cur[i];
      cur[i] += d * k;
      maxD = Math.max(maxD, Math.abs(d));
    }
    this.pole.lerp(this.poleTarget, k);
    if (maxD < 1e-3) {
      cur.set(this.target);
      this.pole.copy(this.poleTarget);
      this.settled = true;
    }
    this.tex.commit();
  }

  dispose() {
    this.tex.dispose();
  }
}

interface LutPair {
  r: ScalarTexture;
  t: ScalarTexture;
  rTarget: Float32Array;
  tTarget: Float32Array;
  settled: boolean;
}

export class OrganismRig {
  readonly material: ShaderMaterial;
  readonly nucleiMaterial: ShaderMaterial;
  readonly nucleiGeometry: BufferGeometry;

  /** Current overall scale (embryo small -> mature 1). Applied by the component to the group. */
  scale = 0.5;
  /** Current ellipsoid stretch (for raycast proxy + uv picking). */
  readonly stretch = new Vector3(1, 1, 1);
  /** 0..1 how "grown" the organism is (for the host: e.g. dust/backdrop glow). */
  maturity = 0;
  hueColor = new Color(0.45, 0.55, 0.7);

  private readonly useFloat: boolean;
  private readonly neutral: Texture;
  private readonly soma: FieldAnim;
  private readonly relief: FieldAnim;
  private reliefUrl: string | null = null;
  private reliefRequest = 0;
  private reliefReady = false;
  private lut: LutPair;

  // morph (genome)
  private morphTarget: Morphology = morphologyFromGenome(null);
  private readonly lobeCur: number[][];
  private readonly sharpCur: number[];
  private readonly seedCur = new Vector3();

  // scalar targets
  private t = {
    embryo: 1,
    scale: 0.52,
    formAmp: 0.2,
    somaAmp: 0,
    reliefAmp: 0,
    irid: 0,
    hasCol: 0,
    cellDetail: 0,
    nucleiGlow: 0,
    nucleiPoints: 0,
    maturity: 0,
    rScale: 1,
    tScale: 1,
  };
  private c = { ...this.t };
  private hueTarget = new Color(0.45, 0.55, 0.7);

  // colour texture crossfade
  private colA: Texture;
  private colB: Texture;
  private colMix = 1;
  private colFading = false;
  private colUrl: string | null = null;
  private colRequest = 0;
  private readonly owned = new Set<Texture>();

  // change detection
  private genomeKey: string | null = null;
  private colonyKey: string | null = null;
  private somaRef: unknown = null;
  private lutRef: unknown = null;

  // wounds
  private localWounds: Wound[] = [];
  private breathPhase = 0;
  private audio = 0;
  private entangle = 0.45;

  constructor(gl: WebGLRenderer) {
    this.useFloat = floatLinearSupported(gl);
    this.neutral = solidTexture(110, 120, 135);
    this.colA = this.neutral;
    this.colB = this.neutral;
    this.soma = new FieldAnim(this.useFloat);
    this.relief = new FieldAnim(this.useFloat);
    this.lut = this.makeLut(2, 2);

    const m = this.morphTarget;
    this.lobeCur = m.lobes.map((l) => [...l]);
    this.sharpCur = [...m.sharp];
    this.seedCur.set(...m.seed);
    this.stretch.set(...m.stretch);

    this.material = new ShaderMaterial({
      vertexShader: organismVertex,
      fragmentShader: organismFragment,
      transparent: true,
      depthWrite: true,
      side: FrontSide,
      uniforms: {
        uTime: { value: 0 },
        // vertex
        uSoma: { value: this.soma.tex.texture },
        uSomaSize: { value: new Vector2(SOMA_RES, SOMA_RES) },
        uSomaAmp: { value: 0 },
        uSomaPole: { value: this.soma.pole },
        uRelief: { value: this.relief.tex.texture },
        uReliefAmp: { value: 0 },
        uReliefPole: { value: this.relief.pole },
        uLobes: { value: Array.from({ length: LOBES }, () => new Vector4()) },
        uLobeSharp: { value: new Float32Array(LOBES) },
        uSeed: { value: new Vector3() },
        uStretch: { value: this.stretch },
        uFormAmp: { value: 0.2 },
        uBreath: { value: 0.01 },
        uBreathPhase: { value: 0 },
        uShiver: { value: 0 },
        // wounds (shared)
        uWoundCount: { value: 0 },
        uWounds: { value: Array.from({ length: MAX_WOUNDS }, () => new Vector4()) },
        uWoundStrength: { value: new Float32Array(MAX_WOUNDS) },
        uEntangle: { value: 0.45 },
        // fragment
        uColA: { value: this.colA },
        uColB: { value: this.colB },
        uColASize: { value: new Vector2(1, 1) },
        uColBSize: { value: new Vector2(1, 1) },
        uColMix: { value: 1 },
        uHasCol: { value: 0 },
        uRLut: { value: this.lut.r.texture },
        uTLut: { value: this.lut.t.texture },
        uRScale: { value: 1 },
        uTScale: { value: 1 },
        uIrid: { value: 0 },
        uThickness: { value: 500 },
        uThickVar: { value: 0.22 },
        uEmbryo: { value: 1 },
        uHue: { value: new Color(0.45, 0.55, 0.7) },
        uCellDetail: { value: 0 },
        uDecayTau: { value: 20 },
        uNucleiCount: { value: 0 },
        uNuclei: { value: Array.from({ length: MAX_NUCLEI }, () => new Vector4()) },
        uNucleiColor: { value: Array.from({ length: MAX_NUCLEI }, () => new Vector3()) },
        uNucleiGlow: { value: 0 },
      },
    });

    this.nucleiGeometry = new BufferGeometry();
    this.nucleiGeometry.setAttribute("position", new BufferAttribute(new Float32Array(MAX_NUCLEI_ART * 3), 3));
    this.nucleiGeometry.setAttribute("aColor", new BufferAttribute(new Float32Array(MAX_NUCLEI_ART * 3), 3));
    this.nucleiGeometry.setAttribute("aInfo", new BufferAttribute(new Float32Array(MAX_NUCLEI_ART * 2), 2));
    this.nucleiGeometry.setDrawRange(0, 0);
    this.nucleiMaterial = new ShaderMaterial({
      vertexShader: nucleiVertex,
      fragmentShader: nucleiFragment,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPxPerUnit: { value: 800 }, uAlpha: { value: 0 } },
    });

    this.applyMorph(1);
  }

  /* ------------------------------------------------------------------ input */

  setSpecimen(s: Specimen | null) {
    // genome -> base form
    const gKey = s?.genome?.hex ?? (s?.genome?.bytes ? s.genome.bytes.join(",") : null);
    if (gKey !== this.genomeKey) {
      this.genomeKey = gKey;
      this.morphTarget = morphologyFromGenome(s?.genome?.bytes ?? null);
    }

    // colony -> nuclei + hue
    const col = s?.colony;
    const cKey = col ? `${col.numQubits}:${col.bloch.map((b) => `${b.x.toFixed(3)},${b.y.toFixed(3)},${b.z.toFixed(3)}`).join("|")}` : null;
    if (cKey !== this.colonyKey) {
      this.colonyKey = cKey;
      this.setNuclei(s);
    }

    // colour: Blur tissue > Tessa skin > colony seed
    const url = s?.tissue?.url || s?.skin?.url || s?.colony?.seed?.url || null;
    if (url !== this.colUrl) {
      this.colUrl = url;
      if (url) this.loadColour(url);
    }

    // soma
    if (s?.soma !== this.somaRef) {
      this.somaRef = s?.soma ?? null;
      this.soma.setTarget(somaField(s?.soma));
    }

    // colony relief (macro-cells aligned with the coloured cells of the seed)
    const seedUrl = s?.colony?.seed?.url || null;
    if (seedUrl !== this.reliefUrl) {
      this.reliefUrl = seedUrl;
      this.reliefReady = false;
      const req = ++this.reliefRequest;
      if (!seedUrl) this.relief.setTarget(null);
      else
        loadImagePixels(seedUrl).then((px) => {
          if (req !== this.reliefRequest) return;
          this.relief.setTarget(px ? colonyRelief(px.data, px.width, px.height) : null);
          this.reliefReady = !!px;
          this.t.reliefAmp = px && this.colonyKey ? RELIEF_AMP : 0;
        });
    }

    // membrane LUTs
    const mem = s?.membrane;
    const lutKey = mem ? mem.rLut : null;
    if (lutKey !== this.lutRef) {
      this.lutRef = lutKey;
      if (mem && lutValid(mem.rLut) && lutValid(mem.tLut)) this.setLuts(mem.rLut, mem.tLut);
    }

    // growth targets (each property arrives as its stage lands)
    const hasGenome = !!s?.genome;
    const hasColony = !!s?.colony;
    const hasSkin = !!(s?.skin || s?.tissue);
    const hasSoma = !!somaField(s?.soma);
    const hasMembrane = !!(mem && lutValid(mem.rLut) && lutValid(mem.tLut));
    const t = this.t;
    t.embryo = hasSkin ? 0 : hasColony ? 0.5 : 1;
    t.scale = hasSkin ? 1 : hasColony ? 0.8 : hasGenome ? 0.6 : 0.52;
    t.formAmp = (hasSkin ? 1 : hasColony ? 0.65 : hasGenome ? 0.4 : 0.25) * this.morphTarget.formAmp;
    t.somaAmp = hasSoma ? SOMA_AMP : 0;
    t.reliefAmp = hasColony && this.reliefReady ? RELIEF_AMP : 0;
    t.irid = hasMembrane ? 1 : 0;
    t.cellDetail = hasSkin ? 1 : hasColony ? 0.55 : 0;
    t.nucleiGlow = hasColony ? (hasSkin ? 0.1 : 0.55) : 0;
    t.nucleiPoints = hasColony ? (hasSkin ? 0 : 1) : 0;
    t.maturity = [hasGenome, hasColony, hasSkin, !!s?.tissue, hasSoma, hasMembrane, !!(s?.voice || s?.echo)].filter(Boolean).length / 7;
    if (!url) t.hasCol = 0;
  }

  /** Immediate local ripple (the store's pendingWounds is merged too). */
  addLocalWound(w: Wound) {
    this.localWounds.push(w);
    if (this.localWounds.length > MAX_WOUNDS * 2) this.localWounds.splice(0, this.localWounds.length - MAX_WOUNDS * 2);
  }

  setPixelScale(pxPerUnit: number) {
    this.nucleiMaterial.uniforms.uPxPerUnit.value = pxPerUnit;
  }

  /* ----------------------------------------------------------------- update */

  update(dt: number, time: number, nowMs: number, st: StoreSlice) {
    const u = this.material.uniforms;
    const t = this.t;
    const c = this.c;

    c.embryo = approach(c.embryo, t.embryo, dt, TAU_SLOW);
    c.scale = approach(c.scale, t.scale, dt, TAU_SLOW);
    c.formAmp = approach(c.formAmp, t.formAmp, dt, TAU_SLOW);
    c.somaAmp = approach(c.somaAmp, t.somaAmp, dt, TAU_FAST);
    c.reliefAmp = approach(c.reliefAmp, t.reliefAmp, dt, TAU_SLOW);
    c.irid = approach(c.irid, t.irid, dt, TAU_FAST);
    c.hasCol = approach(c.hasCol, t.hasCol, dt, TAU_FAST);
    c.cellDetail = approach(c.cellDetail, t.cellDetail, dt, TAU_SLOW);
    c.nucleiGlow = approach(c.nucleiGlow, t.nucleiGlow, dt, TAU_SLOW);
    c.nucleiPoints = approach(c.nucleiPoints, t.nucleiPoints, dt, TAU_SLOW);
    c.maturity = approach(c.maturity, t.maturity, dt, TAU_SLOW);
    c.rScale = approach(c.rScale, t.rScale, dt, TAU_FAST);
    c.tScale = approach(c.tScale, t.tScale, dt, TAU_FAST);
    this.maturity = c.maturity;

    const hc = u.uHue.value as Color;
    const k = 1 - Math.exp(-dt / TAU_SLOW);
    hc.r += (this.hueTarget.r - hc.r) * k;
    hc.g += (this.hueTarget.g - hc.g) * k;
    hc.b += (this.hueTarget.b - hc.b) * k;
    this.hueColor.copy(hc);

    // controls + audio
    const ctl = st.controls;
    this.entangle = approach(this.entangle, clamp01(ctl?.entanglement ?? 0.45), dt, 0.15);
    this.audio = approach(this.audio, clamp01(st.audioLevel || 0), dt, 0.08);
    const decay = clamp01(ctl?.decay ?? 0.5);
    this.breathPhase += dt * Math.PI * 2 * (0.16 + this.audio * 0.34);

    // genome morph lerp
    this.applyMorph(1 - Math.exp(-dt / TAU_SLOW));

    // soma + colony relief lerp (CPU, 32x32) — displacement lerps in
    this.soma.step(dt, TAU_FAST);
    this.relief.step(dt, TAU_SLOW);

    // LUT lerp (CPU) — iridescence morphs between membranes of equal resolution
    if (!this.lut.settled) {
      const kk = 1 - Math.exp(-dt / TAU_FAST);
      let maxD = 0;
      for (const [tex, target] of [
        [this.lut.r, this.lut.rTarget],
        [this.lut.t, this.lut.tTarget],
      ] as const) {
        const cur = tex.values;
        for (let i = 0; i < cur.length; i++) {
          const d = target[i] - cur[i];
          cur[i] += d * kk;
          maxD = Math.max(maxD, Math.abs(d));
        }
        tex.commit();
      }
      if (maxD < 1e-3) {
        this.lut.r.set(this.lut.rTarget);
        this.lut.t.set(this.lut.tTarget);
        this.lut.settled = true;
      }
    }

    // colour crossfade
    if (this.colFading) {
      this.colMix = Math.min(1, this.colMix + dt / TRANSITION);
      if (this.colMix >= 1) this.colFading = false;
    }

    // wounds
    this.updateWounds(nowMs, st.pendingWounds);

    u.uTime.value = time;
    u.uSomaAmp.value = c.somaAmp;
    u.uReliefAmp.value = c.reliefAmp;
    u.uFormAmp.value = c.formAmp;
    u.uBreath.value = 0.009 + 0.04 * this.audio;
    u.uBreathPhase.value = this.breathPhase;
    u.uShiver.value = 0.007 * this.audio;
    u.uEntangle.value = this.entangle;
    u.uColMix.value = smooth(this.colMix);
    u.uHasCol.value = c.hasCol;
    u.uRScale.value = c.rScale;
    u.uTScale.value = c.tScale;
    u.uIrid.value = c.irid;
    u.uEmbryo.value = c.embryo;
    u.uCellDetail.value = c.cellDetail;
    u.uDecayTau.value = 40 + (5 - 40) * decay;
    u.uNucleiGlow.value = c.nucleiGlow;

    this.nucleiMaterial.uniforms.uTime.value = time;
    this.nucleiMaterial.uniforms.uAlpha.value = c.nucleiPoints;

    // embryo heartbeat (lub-dub) on top of the growth scale
    const beatT = time * Math.PI * 2 * 0.85;
    const beat = Math.pow(Math.max(0, Math.sin(beatT)), 14) + 0.55 * Math.pow(Math.max(0, Math.sin(beatT - 0.75)), 14);
    this.scale = c.scale * (1 + c.embryo * 0.04 * beat);
  }

  /* ---------------------------------------------------------------- helpers */

  private applyMorph(k: number) {
    const m = this.morphTarget;
    const u = this.material.uniforms;
    const lobes = u.uLobes.value as Vector4[];
    const sharp = u.uLobeSharp.value as Float32Array;
    for (let i = 0; i < LOBES; i++) {
      const cur = this.lobeCur[i];
      const tgt = m.lobes[i];
      for (let j = 0; j < 4; j++) cur[j] += (tgt[j] - cur[j]) * k;
      const len = Math.hypot(cur[0], cur[1], cur[2]) || 1;
      lobes[i].set(cur[0] / len, cur[1] / len, cur[2] / len, cur[3]);
      this.sharpCur[i] += (m.sharp[i] - this.sharpCur[i]) * k;
      sharp[i] = this.sharpCur[i];
    }
    this.seedCur.x += (m.seed[0] - this.seedCur.x) * k;
    this.seedCur.y += (m.seed[1] - this.seedCur.y) * k;
    this.seedCur.z += (m.seed[2] - this.seedCur.z) * k;
    (u.uSeed.value as Vector3).copy(this.seedCur);
    this.stretch.x += (m.stretch[0] - this.stretch.x) * k;
    this.stretch.y += (m.stretch[1] - this.stretch.y) * k;
    this.stretch.z += (m.stretch[2] - this.stretch.z) * k;
  }

  private setNuclei(s: Specimen | null) {
    const nuclei = nucleiFromColony(s?.colony);
    const u = this.material.uniforms;
    const dirs = u.uNuclei.value as Vector4[];
    const cols = u.uNucleiColor.value as Vector3[];
    const n = Math.min(nuclei.length, MAX_NUCLEI);
    const pos = this.nucleiGeometry.getAttribute("position") as BufferAttribute;
    const col = this.nucleiGeometry.getAttribute("aColor") as BufferAttribute;
    const info = this.nucleiGeometry.getAttribute("aInfo") as BufferAttribute;
    for (let i = 0; i < n; i++) {
      const nu = nuclei[i];
      dirs[i].set(nu.dir[0], nu.dir[1], nu.dir[2], nu.phase);
      cols[i].set(nu.color[0], nu.color[1], nu.color[2]);
      const r = 0.62 + 0.18 * nu.strength;
      pos.setXYZ(i, nu.dir[0] * r, nu.dir[1] * r, nu.dir[2] * r);
      col.setXYZ(i, nu.color[0], nu.color[1], nu.color[2]);
      info.setXY(i, nu.phase, nu.strength);
    }
    pos.needsUpdate = col.needsUpdate = info.needsUpdate = true;
    this.nucleiGeometry.setDrawRange(0, n);
    this.nucleiGeometry.computeBoundingSphere();
    u.uNucleiCount.value = n;

    const hue = specimenHue(s?.colony);
    if (hue !== null) {
      const rgb = srgbToLinear(hslToRgb(hue, 0.6, 0.55));
      this.hueTarget.setRGB(rgb[0], rgb[1], rgb[2]);
    } else {
      this.hueTarget.setRGB(0.45 * 0.5, 0.55 * 0.5, 0.7 * 0.5);
    }
  }

  private loadColour(url: string) {
    const req = ++this.colRequest;
    loadImageTexture(url)
      .then((tex) => {
        if (req !== this.colRequest) {
          tex.dispose();
          return;
        }
        this.owned.add(tex);
        const u = this.material.uniforms;
        // whatever is currently dominant becomes A, the new artifact fades in as B
        const dominant = this.colMix >= 0.5 ? this.colB : this.colA;
        const hadColour = this.t.hasCol > 0.5 || this.c.hasCol > 0.05;
        const prevA = this.colA;
        const prevB = this.colB;
        this.colA = hadColour ? dominant : tex;
        this.colB = tex;
        this.colMix = hadColour ? 0 : 1;
        this.colFading = hadColour;
        u.uColA.value = this.colA;
        u.uColB.value = this.colB;
        (u.uColASize.value as Vector2).set(...textureSize(this.colA));
        (u.uColBSize.value as Vector2).set(...textureSize(this.colB));
        this.t.hasCol = 1;
        for (const old of [prevA, prevB]) {
          if (old !== this.colA && old !== this.colB && this.owned.has(old)) {
            this.owned.delete(old);
            old.dispose();
          }
        }
      })
      .catch(() => {
        /* keep the previous tissue on screen — never a broken frame */
      });
  }

  private makeLut(w: number, h: number): LutPair {
    const r = new ScalarTexture(w, h, this.useFloat, RepeatWrapping, 0.5);
    const t = new ScalarTexture(w, h, this.useFloat, RepeatWrapping, 0.5);
    return { r, t, rTarget: new Float32Array(w * h).fill(0.5), tTarget: new Float32Array(w * h).fill(0.5), settled: true };
  }

  private setLuts(rl: Lut, tl: Lut) {
    const u = this.material.uniforms;
    const sameSize = this.lut.r.width === rl.width && this.lut.r.height === rl.height && this.lut.t.width === tl.width && this.lut.t.height === tl.height;
    const hadMembrane = this.c.irid > 0.05 && this.lut.r.width > 2;
    if (!sameSize) {
      this.lut.r.dispose();
      this.lut.t.dispose();
      this.lut = {
        r: new ScalarTexture(rl.width, rl.height, this.useFloat, RepeatWrapping, 0),
        t: new ScalarTexture(tl.width, tl.height, this.useFloat, RepeatWrapping, 0),
        rTarget: new Float32Array(rl.width * rl.height),
        tTarget: new Float32Array(tl.width * tl.height),
        settled: true,
      };
      u.uRLut.value = this.lut.r.texture;
      u.uTLut.value = this.lut.t.texture;
    }
    for (let i = 0; i < this.lut.rTarget.length; i++) this.lut.rTarget[i] = finite(rl.data[i]);
    for (let i = 0; i < this.lut.tTarget.length; i++) this.lut.tTarget[i] = finite(tl.data[i]);
    if (!sameSize || !hadMembrane) {
      // first membrane (or new resolution): upload directly and fade the iridescence in
      this.lut.r.set(this.lut.rTarget);
      this.lut.t.set(this.lut.tTarget);
      this.lut.settled = true;
      if (hadMembrane) this.c.irid = 0;
    } else {
      this.lut.settled = false;
    }
    const rs = lutStats(rl);
    const ts = lutStats(tl);
    this.t.rScale = rs.mean > 1e-6 ? Math.min(4, 0.55 / rs.mean) : 1;
    this.t.tScale = ts.max > 1e-6 ? Math.min(8, 1 / ts.max) : 1;
    if (!hadMembrane) {
      this.c.rScale = this.t.rScale;
      this.c.tScale = this.t.tScale;
    }
  }

  private updateWounds(nowMs: number, pending: Wound[] | undefined) {
    const u = this.material.uniforms;
    const scarLife = (u.uDecayTau.value as number) * 3;
    const life = Math.max(RIPPLE_LIFE, scarLife);
    // merge store + local, dedupe by (t,u,v)
    const seen = new Set<string>();
    const all: Wound[] = [];
    const push = (w: Wound) => {
      const key = `${w.t}:${w.u.toFixed(4)}:${w.v.toFixed(4)}`;
      if (seen.has(key)) return;
      seen.add(key);
      if ((nowMs - w.t) / 1000 < life) all.push(w);
    };
    for (const w of this.localWounds) push(w);
    if (pending) for (const w of pending) push(w);
    this.localWounds = this.localWounds.filter((w) => (nowMs - w.t) / 1000 < life);
    all.sort((a, b) => b.t - a.t);
    const n = Math.min(all.length, MAX_WOUNDS);
    const arr = u.uWounds.value as Vector4[];
    const str = u.uWoundStrength.value as Float32Array;
    for (let i = 0; i < n; i++) {
      const w = all[i];
      const d: Vec3 = uvToDir(w.u, w.v);
      arr[i].set(d[0], d[1], d[2], Math.max(0, (nowMs - w.t) / 1000));
      str[i] = clamp01(w.strength ?? 1);
    }
    u.uWoundCount.value = n;
  }

  dispose() {
    this.material.dispose();
    this.nucleiMaterial.dispose();
    this.nucleiGeometry.dispose();
    this.soma.dispose();
    this.relief.dispose();
    this.lut.r.dispose();
    this.lut.t.dispose();
    this.neutral.dispose();
    for (const t of this.owned) t.dispose();
  }
}

function clamp01(x: number) {
  return Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));
}
function finite(x: number | undefined) {
  return Number.isFinite(x) ? (x as number) : 0;
}
