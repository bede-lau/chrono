/**
 * OrganismRig — imperative, React-free state machine behind the organism.
 * Owns uniforms/textures, turns artifacts into smooth transitions (never a pop, also back to the embryo when the
 * specimen goes away), drives the Chrono Lens (per-engine amounts, compare wipe, overlays, reveal pulses), the live
 * slider previews, wounds and the linked probe. OWNER: viewport agent.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  FrontSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix3,
  Matrix4,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  Vector4,
  type Camera,
  type IUniform,
  type Texture,
  type WebGLRenderer,
} from "three";
import type { ChronoState } from "@/lib/store";
import { LENS_OFF, type Lut, type Specimen, type Wound } from "@/lib/chain/types";
import {
  LOBES,
  MAX_NUCLEI as MAX_NUCLEI_ART,
  SOMA_RES,
  analyseMask,
  colonyKey,
  colonyRelief,
  fibonacciDirs,
  genomeBits,
  hslToRgb,
  lutStats,
  lutValid,
  morphologyFromGenome,
  nucleiFromColony,
  poleMeans,
  somaField,
  somaPeaks,
  specimenHue,
  srgbToLinear,
  type MaskInfo,
  type Morphology,
} from "./artifacts";
import { LensAnimator, STAGE_INDEX } from "./lens";
import {
  MAX_LINKS,
  MAX_NUCLEI,
  MAX_SCARS,
  MAX_WOUNDS,
  linkNodesFragment,
  linkNodesVertex,
  linksFragment,
  linksVertex,
  nucleiFragment,
  nucleiVertex,
  organismFragment,
  organismVertex,
  shellsFragment,
  shellsVertex,
  sparksFragment,
  sparksVertex,
} from "./shaders";
import { SurfaceSampler, snoise } from "./surface";
import { ScalarTexture, floatLinearSupported, imagePixels, loadImage, solidTexture, textureFromImage } from "./textures";

/** Soma displacement amplitude for a σ-normalised field (≈6 % RMS of the radius, peaks ≈15 %). */
const SOMA_AMP = 0.125;
const RELIEF_AMP = 0.085;
const RIPPLE_LIFE = 5; // s
const TRANSITION = 0.8; // s (texture crossfade)
const TAU_FAST = 0.22; // exponential approach time constant (~95% in 0.66 s)
const TAU_SLOW = 0.32;
const TAU_FADE = 0.3; // artifact presence (arrive / dissolve)
const TAU_SLIDER = 0.1; // live slider preview (responds within ~0.3 s)
const WIPE_HALF = 0.022; // NDC half-width of the compare transition
const SPARKS = 256;
const LINK_SEG = 40;
const SHELL_MAX = 12;
const TWO_PI = Math.PI * 2;

const approach = (cur: number, target: number, dt: number, tau: number) => cur + (target - cur) * (1 - Math.exp(-dt / tau));
const smooth = (x: number) => x * x * (3 - 2 * x);
const clamp01 = (x: number) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));
const finite = (x: number | undefined) => (Number.isFinite(x) ? (x as number) : 0);
const byNewest = (a: Wound, b: Wound) => b.t - a.t;

/** Wound-convention (u, v = 1 north) -> unit direction, written into `out` (no allocation). */
function uvInto(u: number, v: number, out: Vector3 | Vector4) {
  const phi = u * TWO_PI;
  const polar = (1 - Math.min(Math.max(v, 0), 1)) * Math.PI;
  const s = Math.sin(polar);
  out.x = -Math.cos(phi) * s;
  out.y = Math.cos(polar);
  out.z = Math.sin(phi) * s;
}

export type RigInput = Pick<ChronoState, "controls" | "audioLevel" | "pendingWounds" | "lens" | "probe" | "runs" | "mode">;

/** A SOMA_RES² field that lerps (CPU) towards its target, including its pole values. */
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
    const kk = 1 - Math.exp(-dt / tau);
    const cur = this.tex.values;
    let maxD = 0;
    for (let i = 0; i < cur.length; i++) {
      const d = this.target[i] - cur[i];
      cur[i] += d * kk;
      maxD = Math.max(maxD, Math.abs(d));
    }
    this.pole.lerp(this.poleTarget, kk);
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

/**
 * One artifact image on the organism (colony seed, Tessa skin, Blur tissue, wound mask): crossfades A -> B when it
 * changes, fades its presence in/out, and releases its textures once it has fully faded away.
 */
class TexSlot {
  a: Texture;
  b: Texture;
  metaA: MaskInfo | null = null;
  metaB: MaskInfo | null = null;
  readonly size = new Vector4(1, 1, 1, 1);
  mix = 1;
  presence = 0;
  target = 0;
  url: string | null = null;
  private req = 0;
  private fading = false;

  constructor(
    private readonly neutral: Texture,
    private readonly srgb: boolean,
    private readonly analyse?: (img: HTMLImageElement) => MaskInfo | null,
  ) {
    this.a = neutral;
    this.b = neutral;
  }

  set(url: string | null) {
    if (url === this.url) return;
    this.url = url;
    const req = ++this.req;
    if (!url) {
      this.target = 0;
      return;
    }
    loadImage(url)
      .then((img) => {
        if (req !== this.req) return;
        const tex = textureFromImage(img, this.srgb);
        const meta = this.analyse ? this.analyse(img) : null;
        const w = Math.max(1, img.naturalWidth || img.width || 1);
        const h = Math.max(1, img.naturalHeight || img.height || 1);
        const prevA = this.a;
        const prevB = this.b;
        if (this.presence > 0.04) {
          // whatever is currently dominant becomes A, the new artifact fades in as B
          const domB = this.mix >= 0.5;
          this.a = domB ? this.b : this.a;
          this.metaA = domB ? this.metaB : this.metaA;
          this.size.x = domB ? this.size.z : this.size.x;
          this.size.y = domB ? this.size.w : this.size.y;
          this.mix = 0;
          this.fading = true;
        } else {
          this.a = tex;
          this.metaA = meta;
          this.size.x = w;
          this.size.y = h;
          this.mix = 1;
          this.fading = false;
        }
        this.b = tex;
        this.metaB = meta;
        this.size.z = w;
        this.size.w = h;
        this.target = 1;
        this.release(prevA);
        this.release(prevB);
      })
      .catch(() => {
        /* keep what is on screen — never a broken frame */
      });
  }

  step(dt: number) {
    this.presence = approach(this.presence, this.target, dt, TAU_FADE);
    if (this.fading) {
      this.mix = Math.min(1, this.mix + dt / TRANSITION);
      if (this.mix >= 1) this.fading = false;
    }
    if (this.target === 0 && this.presence < 0.002 && this.b !== this.neutral) {
      // fully dissolved: drop the textures so nothing stale can reappear
      this.presence = 0;
      const a = this.a;
      const b = this.b;
      this.a = this.b = this.neutral;
      this.metaA = this.metaB = null;
      this.release(a);
      this.release(b);
    }
  }

  /** The texture's meta that dominates the crossfade. */
  get meta(): MaskInfo | null {
    return this.mix >= 0.5 ? this.metaB : this.metaA;
  }

  apply(A: IUniform, B: IUniform, size: IUniform, mp: IUniform) {
    A.value = this.a;
    B.value = this.b;
    (size.value as Vector4).copy(this.size);
    (mp.value as Vector2).set(smooth(this.mix), this.presence);
  }

  private release(t: Texture) {
    if (t !== this.neutral && t !== this.a && t !== this.b) t.dispose();
  }

  dispose() {
    for (const t of new Set([this.a, this.b])) if (t !== this.neutral) t.dispose();
  }
}

interface LutPair {
  r: ScalarTexture;
  t: ScalarTexture;
  rTarget: Float32Array;
  tTarget: Float32Array;
  settled: boolean;
}

export interface BlobPick {
  u: number;
  /** v = 1 north (Wound convention). */
  v: number;
  /** Incidence angle 0..π/2 (LUT row axis). */
  theta: number;
  /** Thin-film phase s for R, G, B in [0, 1) (LUT column axis), exactly as the fragment shader computes it. */
  phase: [number, number, number];
}

export class OrganismRig {
  readonly material: ShaderMaterial;
  readonly nucleiMaterial: ShaderMaterial;
  readonly nucleiGeometry: BufferGeometry;
  readonly sparksMaterial: ShaderMaterial;
  readonly sparksGeometry: BufferGeometry;
  readonly linksMaterial: ShaderMaterial;
  readonly linksGeometry: BufferGeometry;
  readonly linkNodesMaterial: ShaderMaterial;
  readonly linkNodesGeometry: BufferGeometry;
  readonly shellsMaterial: ShaderMaterial;
  readonly shellsGeometry: InstancedBufferGeometry;

  /** Current overall scale (embryo small -> mature 1). Applied by the component to the group. */
  scale = 0.5;
  /** Current effective ellipsoid stretch (for the pick proxy). */
  readonly stretch = new Vector3(1, 1, 1);
  /** 0..1 how "grown" the organism is (for the host: e.g. dust/backdrop glow). */
  maturity = 0;
  /** 0..1 how much of the embryo look is showing (embryo spores fade with it). */
  embryo = 1;
  hueColor = new Color(0.45, 0.55, 0.7);
  /** Animation clock (s). `timeScale = 0` freezes motion while transitions keep easing (lab / screenshots). */
  time = 0;
  timeScale = 1;
  /** Visibility hints for the overlay objects (skip draw calls when nothing would show). */
  sparksVisible = false;
  linksVisible = false;
  shellsVisible = false;

  readonly lens = new LensAnimator();

  private readonly useFloat: boolean;
  private readonly neutral: Texture;
  private readonly soma: FieldAnim;
  private readonly relief: FieldAnim;
  private readonly surface: SurfaceSampler;
  private reliefUrl: string | null = null;
  private reliefRequest = 0;
  private reliefReady = false;
  private lut: LutPair;
  private readonly seedSlot: TexSlot;
  private readonly skinSlot: TexSlot;
  private readonly tissueSlot: TexSlot;
  private readonly maskSlot: TexSlot;

  // morph (genome)
  private morphTarget: Morphology = morphologyFromGenome(null);
  private readonly lobeCur: number[][];
  private readonly sharpCur: number[];
  private readonly seedCur = new Vector3();
  private readonly stretchCur = new Vector3(1, 1, 1);

  // scalar targets / current values
  private t = {
    embryo: 1,
    scale: 0.52,
    formAmp: 0.2,
    soma: 0,
    reliefAmp: 0,
    irid: 0,
    cellDetail: 0,
    nucleiGlow: 0,
    nucleiPoints: 0,
    maturity: 0,
    rScale: 1,
    tScale: 1,
    genome: 0,
    echo: 0,
  };
  private c = { ...this.t };
  private hueTarget = new Color(0.45, 0.55, 0.7);

  // change detection
  private has = false;
  private rootId: string | null = null;
  private mode: RigInput["mode"] = "idle";
  private genomeKey: string | null = null;
  private colonyKeyCur: string | null = null;
  private somaRef: unknown = null;
  private lutRef: unknown = null;
  private specimenWounds: Wound[] = [];

  // fade-swaps (nuclei, genome sparks, entangled links): fade out, swap, fade back in
  private nucPending: { s: Specimen | null } | null = null;
  private nucFade = 1;
  private bitsPending: { bits: Float32Array | null } | null = null;
  private bitsFade = 1;
  private linksDirty = false;
  private linksFade = 1;
  private linksEntangle = -1;
  private linksCheckT = 0;
  private linkCount = 0;
  private shellCount = 8;

  // live controls + audio
  private breathPhase = 0;
  private audio = 0;
  private entangle = 0.45;
  private age = 1;

  // wounds
  private localWounds: Wound[] = [];
  private readonly woundBuf: Wound[] = [];

  // compare wipe + probe
  private viewCx = 0;
  private viewR = 0.5;
  private pointerNdcX: number | null = null;
  private wipeX = 0;
  private dragging = false;
  private lastProbe: unknown = null;
  private probeA = 0;
  private probeAntiA = 0;

  // pick scratch (allocation-free)
  private readonly pkInv = new Matrix4();
  private readonly pkMvp = new Matrix4();
  private readonly pkMv = new Matrix4();
  private readonly pkNm = new Matrix3();
  private readonly pkO = new Vector3();
  private readonly pkD = new Vector3();
  private readonly pkP = new Vector3();
  private readonly pkQ = new Vector3();
  private readonly pkS = new Vector3();
  private readonly pkT = new Vector3();
  private readonly pkB = new Vector3();
  private readonly pkN = new Vector3();
  private readonly pkP1 = new Vector3();
  private readonly pkP2 = new Vector3();
  private readonly pkV4 = new Vector4();

  constructor(gl: WebGLRenderer) {
    this.useFloat = floatLinearSupported(gl);
    this.neutral = solidTexture(110, 120, 135);
    this.soma = new FieldAnim(this.useFloat);
    this.relief = new FieldAnim(this.useFloat);
    this.lut = this.makeLut(2, 2);
    this.seedSlot = new TexSlot(this.neutral, true);
    this.skinSlot = new TexSlot(this.neutral, true);
    this.tissueSlot = new TexSlot(this.neutral, true);
    this.maskSlot = new TexSlot(this.neutral, false, (img) => {
      const px = imagePixels(img);
      return px ? analyseMask(px.data, px.width, px.height, this.specimenWounds) : null;
    });

    const m = this.morphTarget;
    this.lobeCur = m.lobes.map((l) => [...l]);
    this.sharpCur = [...m.sharp];
    this.seedCur.set(...m.seed);
    this.stretchCur.set(...m.stretch);

    // uniforms shared by every material that evaluates the organism's surface (shaders.ts DISPLACE)
    const shared: Record<string, IUniform> = {
      uTime: { value: 0 },
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
      uStretch: { value: this.stretchCur },
      uFormAmp: { value: 0.2 },
      uBreath: { value: 0.01 },
      uBreathPhase: { value: 0 },
      uShiver: { value: 0 },
      uWoundCount: { value: 0 },
      uWounds: { value: Array.from({ length: MAX_WOUNDS }, () => new Vector4()) },
      uWoundStrength: { value: new Float32Array(MAX_WOUNDS) },
      uEntangle: { value: 0.45 },
      uLGen: { value: new Vector2(1, 1) },
      uLCol: { value: new Vector2(1, 1) },
      uLSom: { value: new Vector2(1, 1) },
      uLVoi: { value: new Vector2(1, 1) },
      uWipe: { value: new Vector3(0, 0, WIPE_HALF) },
      uHue: { value: new Color(0.45, 0.55, 0.7) },
    };

    this.material = new ShaderMaterial({
      vertexShader: organismVertex,
      fragmentShader: organismFragment,
      transparent: true,
      depthWrite: true,
      side: FrontSide,
      uniforms: {
        ...shared,
        uSeedA: { value: this.neutral },
        uSeedB: { value: this.neutral },
        uSeedSize: { value: new Vector4(1, 1, 1, 1) },
        uSeedMP: { value: new Vector2(1, 0) },
        uSkinA: { value: this.neutral },
        uSkinB: { value: this.neutral },
        uSkinSize: { value: new Vector4(1, 1, 1, 1) },
        uSkinMP: { value: new Vector2(1, 0) },
        uTisA: { value: this.neutral },
        uTisB: { value: this.neutral },
        uTisSize: { value: new Vector4(1, 1, 1, 1) },
        uTisMP: { value: new Vector2(1, 0) },
        uMaskA: { value: this.neutral },
        uMaskB: { value: this.neutral },
        uMaskSize: { value: new Vector4(1, 1, 1, 1) },
        uMaskMP: { value: new Vector2(1, 0) },
        uMaskNorm: { value: new Vector4(0, 0, 0, 0) },
        uRLut: { value: this.lut.r.texture },
        uTLut: { value: this.lut.t.texture },
        uRScale: { value: 1 },
        uTScale: { value: 1 },
        uIrid: { value: 0 },
        uThickness: { value: 500 },
        uThickVar: { value: 0.3 },
        uSomaOn: { value: 0 },
        uEmbryo: { value: 1 },
        uBeat: { value: 0 },
        uCellDetail: { value: 0 },
        uDecayTau: { value: 20 },
        uAge: { value: 1 },
        uNucleiCount: { value: 0 },
        uNuclei: { value: Array.from({ length: MAX_NUCLEI }, () => new Vector4()) },
        uNucleiColor: { value: Array.from({ length: MAX_NUCLEI }, () => new Vector3()) },
        uNucleiGlow: { value: 0 },
        uScarCount: { value: 0 },
        uScars: { value: Array.from({ length: MAX_SCARS }, () => new Vector4()) },
        uLMor: { value: new Vector2(1, 1) },
        uLDec: { value: new Vector2(1, 1) },
        uLMem: { value: new Vector2(1, 1) },
        uOvA: { value: new Vector4() },
        uOvB: { value: new Vector4() },
        uGrid: { value: new Vector2(32, 32) },
        uAudio: { value: 0 },
        uProbe: { value: new Vector4(0, 1, 0, 0) },
        uProbeAnti: { value: 0 },
      },
    });

    // colony nuclei floating inside the embryo
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
      uniforms: { uTime: shared.uTime, uPxPerUnit: { value: 800 }, uAlpha: { value: 0 } },
    });

    // 01 genome sparks
    const pxPerUnit: IUniform = { value: 800 };
    this.sparksGeometry = new BufferGeometry();
    this.sparksGeometry.setAttribute("position", new BufferAttribute(fibonacciDirs(SPARKS), 3));
    this.sparksGeometry.setAttribute("aBit", new BufferAttribute(new Float32Array(SPARKS), 1));
    this.sparksGeometry.setAttribute("aIdx", new BufferAttribute(Float32Array.from({ length: SPARKS }, (_, i) => i), 1));
    this.sparksMaterial = new ShaderMaterial({
      vertexShader: sparksVertex,
      fragmentShader: sparksFragment,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { ...shared, uPxPerUnit: pxPerUnit, uSparkAlpha: { value: 0 } },
    });

    // 05 entangled links (chords) + their end nodes
    const links: IUniform = { value: Array.from({ length: MAX_LINKS }, () => new Vector4(0, 1, 0, 0)) };
    const linkCount: IUniform = { value: 0 };
    const linkAlpha: IUniform = { value: 0 };
    const nSeg = MAX_LINKS * LINK_SEG * 2;
    const aLink = new Float32Array(nSeg);
    const aT = new Float32Array(nSeg);
    for (let i = 0, o = 0; i < MAX_LINKS; i++)
      for (let s = 0; s < LINK_SEG; s++, o += 2) {
        aLink[o] = aLink[o + 1] = i;
        aT[o] = s / LINK_SEG;
        aT[o + 1] = (s + 1) / LINK_SEG;
      }
    this.linksGeometry = new BufferGeometry();
    this.linksGeometry.setAttribute("position", new BufferAttribute(new Float32Array(nSeg * 3), 3));
    this.linksGeometry.setAttribute("aLink", new BufferAttribute(aLink, 1));
    this.linksGeometry.setAttribute("aT", new BufferAttribute(aT, 1));
    this.linksMaterial = new ShaderMaterial({
      vertexShader: linksVertex,
      fragmentShader: linksFragment,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      uniforms: { ...shared, uLinks: links, uLinkCount: linkCount, uLinkAlpha: linkAlpha },
    });
    this.linkNodesGeometry = new BufferGeometry();
    this.linkNodesGeometry.setAttribute("position", new BufferAttribute(new Float32Array(MAX_LINKS * 2 * 3), 3));
    this.linkNodesGeometry.setAttribute("aLink", new BufferAttribute(Float32Array.from({ length: MAX_LINKS * 2 }, (_, i) => i >> 1), 1));
    this.linkNodesGeometry.setAttribute("aEnd", new BufferAttribute(Float32Array.from({ length: MAX_LINKS * 2 }, (_, i) => i & 1), 1));
    this.linkNodesMaterial = new ShaderMaterial({
      vertexShader: linkNodesVertex,
      fragmentShader: linkNodesFragment,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      uniforms: { ...shared, uLinks: links, uLinkCount: linkCount, uLinkAlpha: linkAlpha, uPxPerUnit: pxPerUnit },
    });

    // 08 echo shells (instanced ghosts of the body)
    const sphere = new SphereGeometry(1, 72, 48);
    this.shellsGeometry = new InstancedBufferGeometry();
    this.shellsGeometry.index = sphere.index;
    this.shellsGeometry.setAttribute("position", sphere.getAttribute("position"));
    this.shellsGeometry.setAttribute("aShell", new InstancedBufferAttribute(Float32Array.from({ length: SHELL_MAX }, (_, i) => i), 1));
    this.shellsGeometry.instanceCount = SHELL_MAX;
    this.shellsMaterial = new ShaderMaterial({
      vertexShader: shellsVertex,
      fragmentShader: shellsFragment,
      transparent: true,
      depthWrite: false,
      // Instanced transparent meshes cannot be depth-sorted tap by tap. Additive
      // ghosts are order-independent, so a moving high-depth Echo cannot mask the
      // real organism or flash as instance depths cross.
      blending: AdditiveBlending,
      side: FrontSide,
      uniforms: {
        ...shared,
        uShellCount: { value: 8 },
        uGhost: { value: 0 },
        uLEcho: { value: new Vector2(1, 1) },
        uShellOv: { value: 0 },
        uShellRate: { value: 0.16 },
      },
    });

    this.surface = new SurfaceSampler(this.material.uniforms, this.soma.tex.values, this.relief.tex.values);
    this.applyMorph(1);
  }

  /* ------------------------------------------------------------------ input */

  setSpecimen(s: Specimen | null) {
    const root = s ? s.id.replace(/-g\d+$/, "") : null;
    // a different specimen (or none): drop reveal pulses that belonged to the previous one
    if (!s) {
      this.lens.resetRuns();
      this.localWounds.length = 0;
    } else if (this.rootId && root !== this.rootId && this.rootId !== "embryo" && this.mode === "idle") {
      this.lens.cancelReveal();
    }
    this.rootId = root;
    this.specimenWounds = s?.wounds ?? [];

    // genome -> base form + sparks
    const gKey = s?.genome?.hex ?? (s?.genome?.bytes ? s.genome.bytes.join(",") : null);
    if (gKey !== this.genomeKey) {
      this.genomeKey = gKey;
      this.morphTarget = morphologyFromGenome(s?.genome?.bytes ?? null);
      this.bitsPending = { bits: genomeBits(s?.genome?.bytes) };
    }

    // colony -> nuclei + hue (fade out, swap, fade in)
    const cKey = colonyKey(s?.colony);
    if (cKey !== this.colonyKeyCur) {
      this.colonyKeyCur = cKey;
      this.nucPending = { s };
    }

    // artifact images: colony seed (02) -> Tessa skin (03) -> Blur tissue + its wound mask (04)
    this.seedSlot.set(s?.colony?.seed?.url || null);
    this.skinSlot.set(s?.skin?.url || null);
    this.tissueSlot.set(s?.tissue?.url || null);
    this.maskSlot.set((s?.tissue && s?.mask?.url) || null);
    const grid = this.material.uniforms.uGrid.value as Vector2;
    if (s?.skin) grid.set(Math.max(1, s.skin.width || 32), Math.max(1, s.skin.height || 32));

    // soma
    if ((s?.soma ?? null) !== this.somaRef) {
      this.somaRef = s?.soma ?? null;
      this.soma.setTarget(somaField(s?.soma));
      this.linksDirty = true;
    }

    // colony relief (macro-cells aligned with the coloured cells of the seed)
    const seedUrl = s?.colony?.seed?.url || null;
    if (seedUrl !== this.reliefUrl) {
      this.reliefUrl = seedUrl;
      this.reliefReady = false;
      const req = ++this.reliefRequest;
      if (!seedUrl) this.relief.setTarget(null);
      else
        loadImage(seedUrl)
          .then((img) => {
            if (req !== this.reliefRequest) return;
            const px = imagePixels(img);
            this.relief.setTarget(px ? colonyRelief(px.data, px.width, px.height) : null);
            this.reliefReady = !!px;
            this.t.reliefAmp = px && this.colonyKeyCur ? RELIEF_AMP : 0;
          })
          .catch(() => {});
    }

    // membrane LUTs
    const mem = s?.membrane;
    const lutKey = mem ? mem.rLut : null;
    if (lutKey !== this.lutRef) {
      this.lutRef = lutKey;
      if (mem && lutValid(mem.rLut) && lutValid(mem.tLut)) this.setLuts(mem.rLut, mem.tLut);
    }

    // echo: one shell per tap of the quantum delay (circuit depth)
    const depth = Number(s?.runs?.echo?.params?.depth);
    this.shellCount = Number.isFinite(depth) && depth > 0 ? Math.min(SHELL_MAX, Math.max(1, Math.round(depth))) : 8;

    // growth targets (each property arrives as its stage lands; everything dissolves back when it goes away)
    const hasGenome = !!s?.genome;
    const hasColony = !!s?.colony;
    const hasSkin = !!(s?.skin || s?.tissue);
    const hasSoma = !!somaField(s?.soma);
    const hasMembrane = !!(mem && lutValid(mem.rLut) && lutValid(mem.tLut));
    this.has = hasGenome || hasColony || hasSkin;
    const t = this.t;
    t.embryo = hasSkin ? 0 : hasColony ? 0.5 : 1;
    t.scale = hasSkin ? 1 : hasColony ? 0.8 : hasGenome ? 0.6 : 0.52;
    t.formAmp = (hasSkin ? 1 : hasColony ? 0.65 : hasGenome ? 0.4 : 0.25) * this.morphTarget.formAmp;
    t.soma = hasSoma ? 1 : 0;
    t.reliefAmp = hasColony && this.reliefReady ? RELIEF_AMP : 0;
    t.irid = hasMembrane ? 1 : 0;
    t.cellDetail = hasSkin ? 1 : hasColony ? 0.55 : 0;
    t.nucleiGlow = hasColony ? (hasSkin ? 0.16 : 0.55) : 0;
    t.nucleiPoints = hasColony ? (hasSkin ? 0 : 1) : 0;
    t.genome = hasGenome ? 1 : 0;
    t.echo = s?.echo ? 1 : 0;
    t.maturity = [hasGenome, hasColony, hasSkin, !!s?.tissue, hasSoma, hasMembrane, !!(s?.voice || s?.echo)].filter(Boolean).length / 7;
  }

  /** Immediate local ripple (the store's pendingWounds is merged too). */
  addLocalWound(w: Wound) {
    this.localWounds.push(w);
    if (this.localWounds.length > MAX_WOUNDS * 2) this.localWounds.splice(0, this.localWounds.length - MAX_WOUNDS * 2);
  }

  setPixelScale(pxPerUnit: number) {
    this.nucleiMaterial.uniforms.uPxPerUnit.value = pxPerUnit;
    this.sparksMaterial.uniforms.uPxPerUnit.value = pxPerUnit;
  }

  /** The blob's centre and radius on screen (NDC x units), for the compare wipe's sweep. */
  setView(centreNdcX: number, radiusNdc: number) {
    this.viewCx = centreNdcX;
    this.viewR = Math.max(0.05, radiusNdc);
  }

  /** Pointer over the blob (NDC x) -> the compare wipe follows it; null when the pointer leaves. */
  setPointer(ndcX: number | null) {
    this.pointerNdcX = ndcX;
  }

  setDragging(active: boolean) {
    this.dragging = active;
  }

  /** Lab / tests: play a stage's reveal pulse now. */
  playReveal(stage: keyof typeof STAGE_INDEX) {
    this.lens.playReveal(STAGE_INDEX[stage]);
  }

  /* ----------------------------------------------------------------- update */

  update(dt: number, nowMs: number, st: RigInput) {
    const u = this.material.uniforms;
    const t = this.t;
    const c = this.c;
    this.time += dt * this.timeScale;
    const time = this.time;
    this.mode = st.mode;
    const lensState = st.lens ?? LENS_OFF;
    const has = this.has;

    // ---- lens + reveal pulses
    this.lens.watchRuns(st.runs ?? {}, nowMs);
    this.lens.update(dt, lensState, has, this.dragging);
    const L = this.lens.L;
    const R = this.lens.R;
    const ov = this.lens.ov;

    // ---- growth / dissolve
    c.embryo = approach(c.embryo, t.embryo, dt, TAU_SLOW);
    c.scale = approach(c.scale, t.scale, dt, TAU_SLOW);
    c.formAmp = approach(c.formAmp, t.formAmp, dt, TAU_SLOW);
    c.soma = approach(c.soma, t.soma, dt, TAU_FAST);
    c.reliefAmp = approach(c.reliefAmp, t.reliefAmp, dt, TAU_SLOW);
    c.irid = approach(c.irid, t.irid, dt, TAU_FAST);
    c.cellDetail = approach(c.cellDetail, t.cellDetail, dt, TAU_SLOW);
    c.nucleiGlow = approach(c.nucleiGlow, t.nucleiGlow, dt, TAU_SLOW);
    c.nucleiPoints = approach(c.nucleiPoints, t.nucleiPoints, dt, TAU_SLOW);
    c.maturity = approach(c.maturity, t.maturity, dt, TAU_SLOW);
    c.rScale = approach(c.rScale, t.rScale, dt, TAU_FAST);
    c.tScale = approach(c.tScale, t.tScale, dt, TAU_FAST);
    c.genome = approach(c.genome, t.genome, dt, TAU_FADE);
    c.echo = approach(c.echo, t.echo, dt, TAU_FADE);
    this.maturity = c.maturity;
    this.embryo = c.embryo;

    const hc = u.uHue.value as Color;
    const kh = 1 - Math.exp(-dt / TAU_SLOW);
    hc.r += (this.hueTarget.r - hc.r) * kh;
    hc.g += (this.hueTarget.g - hc.g) * kh;
    hc.b += (this.hueTarget.b - hc.b) * kh;
    this.hueColor.copy(hc);

    // ---- live slider previews (only meaningful once the engines' artifacts exist)
    const ctl = st.controls;
    this.entangle = approach(this.entangle, clamp01(ctl?.entanglement ?? 0.45), dt, TAU_SLIDER);
    const decay = clamp01(ctl?.decay ?? 0.5);
    this.age = approach(this.age, 0.3 + 1.4 * decay, dt, TAU_SLIDER);
    this.audio = approach(this.audio, clamp01(st.audioLevel || 0), dt, 0.08);
    const voiceLens = lensState.stage === "voice" && has;
    this.breathPhase += dt * this.timeScale * Math.PI * 2 * (0.16 + this.audio * 0.34 + (voiceLens ? 0.1 : 0));

    // ---- fade-swaps
    this.stepSwaps(dt);

    // genome morph lerp
    this.applyMorph(1 - Math.exp(-dt / TAU_SLOW));

    // soma + colony relief lerp (CPU, 32x32)
    this.soma.step(dt, TAU_FAST);
    this.relief.step(dt, TAU_SLOW);

    // LUT lerp (CPU) — iridescence morphs between membranes of equal resolution
    this.stepLut(dt);

    // artifact images
    this.seedSlot.step(dt);
    this.skinSlot.step(dt);
    this.tissueSlot.step(dt);
    this.maskSlot.step(dt);
    this.seedSlot.apply(u.uSeedA, u.uSeedB, u.uSeedSize, u.uSeedMP);
    this.skinSlot.apply(u.uSkinA, u.uSkinB, u.uSkinSize, u.uSkinMP);
    this.tissueSlot.apply(u.uTisA, u.uTisB, u.uTisSize, u.uTisMP);
    this.maskSlot.apply(u.uMaskA, u.uMaskB, u.uMaskSize, u.uMaskMP);
    this.applyMaskMeta();

    // wounds
    this.updateWounds(nowMs, st.pendingWounds);

    // ---- compare wipe: slow sweep between 25 % and 75 % of the blob's width, or follow the pointer
    const sweep = this.viewCx + 0.5 * this.viewR * Math.sin((time * TWO_PI) / 9);
    const wipeTarget = this.pointerNdcX ?? sweep;
    this.wipeX = approach(this.wipeX, wipeTarget, dt, this.pointerNdcX !== null ? 0.05 : 0.25);
    (u.uWipe.value as Vector3).set(this.wipeX, this.lens.compare < 0.002 ? 0 : this.lens.compare, WIPE_HALF);

    // ---- linked probe from the panel
    const probe = st.probe;
    if (probe !== this.lastProbe) {
      this.lastProbe = probe;
      if (probe && probe.source === "panel") uvInto(probe.u, probe.v, u.uProbe.value as Vector4);
    }
    const showProbe = !!(probe && probe.source === "panel" && has);
    this.probeA = approach(this.probeA, showProbe ? 1 : 0, dt, 0.12);
    this.probeAntiA = approach(this.probeAntiA, showProbe && lensState.stage === "soma" ? 1 : 0, dt, 0.12);
    (u.uProbe.value as Vector4).w = this.probeA < 0.002 ? 0 : this.probeA;
    u.uProbeAnti.value = this.probeAntiA < 0.002 ? 0 : this.probeAntiA;

    // ---- uniforms
    u.uTime.value = time;
    (u.uLGen.value as Vector2).set(L[0], R[0]);
    (u.uLCol.value as Vector2).set(L[1], R[1]);
    (u.uLMor.value as Vector2).set(L[2], R[2]);
    (u.uLDec.value as Vector2).set(L[3], R[3]);
    (u.uLSom.value as Vector2).set(L[4], R[4]);
    (u.uLMem.value as Vector2).set(L[5], R[5]);
    (u.uLVoi.value as Vector2).set(L[6], R[6]);
    const ovOn = has ? 1 : 0;
    (u.uOvA.value as Vector4).set(ov[1] * ovOn, ov[2] * ovOn * this.skinSlot.presence, ov[3] * ovOn * this.maskSlot.presence, ov[4] * ovOn * c.soma);
    (u.uOvB.value as Vector4).set(ov[5] * ovOn * c.irid, ov[6] * ovOn, 0, 0);

    u.uSomaAmp.value = SOMA_AMP * c.soma * (0.7 + 0.6 * this.entangle);
    u.uSomaOn.value = c.soma;
    u.uReliefAmp.value = c.reliefAmp;
    u.uFormAmp.value = c.formAmp;
    u.uBreath.value = (voiceLens ? 0.022 : 0.009) + 0.04 * this.audio;
    u.uBreathPhase.value = this.breathPhase;
    u.uShiver.value = 0.007 * this.audio;
    u.uEntangle.value = this.entangle;
    u.uAge.value = this.age;
    u.uAudio.value = this.audio;
    u.uRScale.value = c.rScale;
    u.uTScale.value = c.tScale;
    u.uIrid.value = c.irid;
    u.uEmbryo.value = c.embryo;
    u.uCellDetail.value = c.cellDetail;
    u.uDecayTau.value = 40 + (5 - 40) * decay;
    u.uNucleiGlow.value = c.nucleiGlow * this.nucFade;

    this.nucleiMaterial.uniforms.uAlpha.value = c.nucleiPoints * this.nucFade;

    // 01 genome sparks
    const sparkA = ov[0] * c.genome * this.bitsFade * ovOn;
    this.sparksMaterial.uniforms.uSparkAlpha.value = sparkA;
    this.sparksVisible = sparkA > 0.003;
    // 05 entangled links: present with the overlay, dimmer while the body is smoothed out
    const linkA = ov[4] * c.soma * this.linksFade * (0.4 + 0.6 * R[4]) * ovOn;
    this.linksMaterial.uniforms.uLinkAlpha.value = linkA;
    this.linksVisible = linkA > 0.003 && this.linkCount > 0;
    // 08 echo ghosts: faint around the living body (with the sound), full in the Echo lens; overlay = shells
    const echoLens = lensState.stage === "echo";
    const ghost = c.echo * (echoLens ? 0.9 : 0.16 + 0.5 * this.audio) * ovOn;
    const shellOv = c.echo * ov[7] * ovOn;
    const su = this.shellsMaterial.uniforms;
    su.uGhost.value = ghost;
    (su.uLEcho.value as Vector2).set(L[7], R[7]);
    su.uShellOv.value = shellOv;
    su.uShellCount.value = this.shellCount;
    this.shellsGeometry.instanceCount = this.shellCount;
    this.shellsVisible = Math.max(ghost * Math.max(L[7], R[7]), shellOv) > 0.003;

    // embryo heartbeat (a calm lub-dub) on top of the growth scale
    const beatT = time * Math.PI * 2 * 0.62;
    const beat = Math.min(1, Math.pow(Math.max(0, Math.sin(beatT)), 8) + 0.55 * Math.pow(Math.max(0, Math.sin(beatT - 0.75)), 8));
    u.uBeat.value = beat;
    this.scale = c.scale * (1 + c.embryo * 0.03 * beat);
    const g = (u.uLGen.value as Vector2).y;
    this.stretch.set(1 + (this.stretchCur.x - 1) * g, 1 + (this.stretchCur.y - 1) * g, 1 + (this.stretchCur.z - 1) * g);
  }

  /* ------------------------------------------------------------------- pick */

  /**
   * Resolve a world-space ray to the visible (displaced) surface: ray-march the CPU mirror of the vertex shader.
   * Returns null when the ray misses the body. `groupWorld` = the organism group's matrixWorld.
   */
  pick(rayOrigin: Vector3, rayDir: Vector3, groupWorld: Matrix4, camera: Camera): BlobPick | null {
    const inv = this.pkInv.copy(groupWorld).invert();
    const o = this.pkO.copy(rayOrigin).applyMatrix4(inv);
    const dir = this.pkD.copy(rayOrigin).add(rayDir).applyMatrix4(inv).sub(o).normalize();
    // bounding sphere
    const BR = 1.5;
    const b = o.dot(dir);
    const cc = o.dot(o) - BR * BR;
    const disc = b * b - cc;
    if (disc <= 0) return null;
    const sq = Math.sqrt(disc);
    const t0 = Math.max(0, -b - sq);
    const t1 = -b + sq;
    if (t1 <= t0) return null;

    const mvp = this.pkMvp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(groupWorld);
    const u = this.material.uniforms;
    const wipe = u.uWipe.value as Vector3;
    const st = u.uStretch.value as Vector3;
    const sideAt = (dx: number, dy: number, dz: number) => {
      if (wipe.y <= 0) return 1;
      const v4 = this.pkV4.set(dx * st.x, dy * st.y, dz * st.z, 1).applyMatrix4(mvp);
      const x = v4.x / Math.max(Math.abs(v4.w), 1e-5);
      const e = Math.min(1, Math.max(0, (x - (wipe.x - wipe.z)) / (2 * wipe.z)));
      return 1 + (e * e * (3 - 2 * e) - 1) * wipe.y;
    };
    const p = this.pkP;
    const q = this.pkQ;
    const s = this.pkS;
    // signed distance-ish: |p / stretch| - (1 + disp(d))  (< 0 inside)
    const inside = (tt: number) => {
      p.copy(dir).multiplyScalar(tt).add(o);
      const lenP = p.length() || 1;
      const side = sideAt(p.x / lenP, p.y / lenP, p.z / lenP);
      this.surface.stretchAt(side, s);
      q.set(p.x / s.x, p.y / s.y, p.z / s.z);
      const lam = q.length() || 1e-6;
      q.divideScalar(lam);
      return lam - (1 + this.surface.displacement(q.x, q.y, q.z, side));
    };
    const STEPS = 72;
    const step = (t1 - t0) / STEPS;
    let ta = t0;
    let fa = inside(ta);
    let tb = -1;
    for (let i = 1; i <= STEPS; i++) {
      const tt = t0 + step * i;
      const f = inside(tt);
      if (f < 0 && fa >= 0) {
        tb = tt;
        break;
      }
      ta = tt;
      fa = f;
    }
    if (tb < 0) return null;
    for (let i = 0; i < 12; i++) {
      const tm = 0.5 * (ta + tb);
      if (inside(tm) < 0) tb = tm;
      else ta = tm;
    }
    inside(tb);
    // q = unit direction of the hit
    const dx = q.x, dy = q.y, dz = q.z;
    const lenP = p.length() || 1;
    const side = sideAt(p.x / lenP, p.y / lenP, p.z / lenP);
    // geometric normal exactly like the vertex shader (finite differences in the tangent plane)
    const P0 = this.surface.point(dx, dy, dz, side, this.pkP1.set(0, 0, 0));
    const field = this.surface.field;
    const tv = this.pkT.set(0, 1, 0);
    if (Math.abs(dy) >= 0.99) tv.set(1, 0, 0);
    tv.cross(this.pkN.set(dx, dy, dz)).normalize(); // t = normalize(cross(up, d))
    const bv = this.pkB.set(dx, dy, dz).cross(tv); // b = cross(d, t)
    const EPS = 0.012;
    const n1 = this.pkQ.set(dx + tv.x * EPS, dy + tv.y * EPS, dz + tv.z * EPS).normalize();
    const P1 = this.surface.point(n1.x, n1.y, n1.z, side, this.pkS);
    const n2x = dx + bv.x * EPS, n2y = dy + bv.y * EPS, n2z = dz + bv.z * EPS;
    const l2 = Math.hypot(n2x, n2y, n2z) || 1;
    const P2 = this.surface.point(n2x / l2, n2y / l2, n2z / l2, side, this.pkP2);
    P1.sub(P0);
    P2.sub(P0);
    const N = this.pkN.copy(P1).cross(P2).normalize();
    if (N.x * dx + N.y * dy + N.z * dz < 0) N.negate();
    // to view space
    const mv = this.pkMv.multiplyMatrices(camera.matrixWorldInverse, groupWorld);
    const nm = this.pkNm.getNormalMatrix(mv);
    N.applyMatrix3(nm).normalize();
    const vp = P0.applyMatrix4(mv);
    const vlen = vp.length() || 1;
    const cosT = Math.min(1, Math.abs((N.x * -vp.x + N.y * -vp.y + N.z * -vp.z) / vlen));
    const theta = Math.acos(cosT);

    let uu = Math.atan2(dz, -dx) / TWO_PI;
    uu -= Math.floor(uu);
    const vv = 1 - Math.acos(Math.min(1, Math.max(-1, dy))) / Math.PI;

    // thin-film phase, as organismFragment computes it (contract: D = -2·2π·thickness·cosθ, s = mod(D/λ, 2π)/2π)
    const seed = u.uSeed.value as Vector3;
    const tm = (u.uTime.value as number) * 0.02;
    const nTh = snoise(dx * 1.6 + seed.y + tm, dy * 1.6 + seed.z + tm, dz * 1.6 + seed.x + tm);
    const thickness = (u.uThickness.value as number) * (1 + (u.uThickVar.value as number) * (0.6 * nTh + 0.4 * field * (u.uSomaOn.value as number)));
    const D = -2 * TWO_PI * thickness * cosT;
    const ph = (lambda: number) => {
      const x = D / lambda;
      return (x - TWO_PI * Math.floor(x / TWO_PI)) / TWO_PI;
    };
    return { u: uu, v: vv, theta, phase: [ph(650), ph(530), ph(470)] };
  }

  /* ---------------------------------------------------------------- helpers */

  private stepSwaps(dt: number) {
    // nuclei
    if (this.nucPending) {
      const visible = (this.c.nucleiGlow + this.c.nucleiPoints) * this.nucFade;
      this.nucFade = approach(this.nucFade, 0, dt, 0.07);
      if (visible < 0.02 || this.nucFade < 0.02) {
        this.setNuclei(this.nucPending.s);
        this.nucPending = null;
      }
    } else this.nucFade = approach(this.nucFade, 1, dt, 0.15);

    // genome sparks
    if (this.bitsPending) {
      this.bitsFade = approach(this.bitsFade, 0, dt, 0.06);
      if (this.bitsFade < 0.02 || this.lens.ov[0] < 0.01) {
        const attr = this.sparksGeometry.getAttribute("aBit") as BufferAttribute;
        const bits = this.bitsPending.bits;
        for (let i = 0; i < SPARKS; i++) attr.setX(i, bits ? bits[i] : 0);
        attr.needsUpdate = true;
        this.bitsPending = null;
      }
    } else this.bitsFade = approach(this.bitsFade, 1, dt, 0.15);

    // entangled links follow the soma field and the live Entanglement slider
    this.linksCheckT -= dt;
    if (!this.linksDirty && this.linksCheckT <= 0 && Math.abs(this.entangle - this.linksEntangle) > 0.02) {
      this.linksCheckT = 0.15;
      this.computeLinks();
    }
    if (this.linksDirty) {
      this.linksFade = approach(this.linksFade, 0, dt, 0.06);
      if (this.linksFade < 0.02 || this.lens.ov[4] < 0.01) {
        this.computeLinks();
        this.linksDirty = false;
      }
    } else this.linksFade = approach(this.linksFade, 1, dt, 0.15);
  }

  private computeLinks() {
    const lu = this.linksMaterial.uniforms;
    const arr = lu.uLinks.value as Vector4[];
    this.linksEntangle = this.entangle;
    const peaks = this.somaRef ? somaPeaks(this.soma.target, this.entangle, MAX_LINKS) : [];
    const top = peaks[0]?.value ?? 1;
    for (let i = 0; i < MAX_LINKS; i++) {
      const pk = peaks[i];
      if (pk) arr[i].set(pk.dir[0], pk.dir[1], pk.dir[2], 0.55 + 0.45 * Math.min(1, pk.value / top));
      else arr[i].set(0, 1, 0, 0);
    }
    this.linkCount = peaks.length;
    lu.uLinkCount.value = peaks.length;
  }

  private applyMaskMeta() {
    const u = this.material.uniforms;
    const norm = u.uMaskNorm.value as Vector4;
    const g = (m: MaskInfo | null) => (m && m.hi - m.lo > 0.06 ? 1 / (m.hi - m.lo) : 0);
    const a = this.maskSlot.metaA;
    const b = this.maskSlot.metaB;
    norm.set(a?.lo ?? 0, g(a), b?.lo ?? 0, g(b));
    const scars = this.maskSlot.meta?.scars ?? [];
    const arr = u.uScars.value as Vector4[];
    const n = Math.min(scars.length, MAX_SCARS);
    for (let i = 0; i < n; i++) {
      uvInto(scars[i].u, scars[i].v, arr[i]);
      arr[i].w = scars[i].strength;
    }
    u.uScarCount.value = n;
  }

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
    this.stretchCur.x += (m.stretch[0] - this.stretchCur.x) * k;
    this.stretchCur.y += (m.stretch[1] - this.stretchCur.y) * k;
    this.stretchCur.z += (m.stretch[2] - this.stretchCur.z) * k;
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

  private stepLut(dt: number) {
    const lut = this.lut;
    if (lut.settled) return;
    const kk = 1 - Math.exp(-dt / TAU_FAST);
    let maxD = 0;
    const cr = lut.r.values;
    for (let i = 0; i < cr.length; i++) {
      const d = lut.rTarget[i] - cr[i];
      cr[i] += d * kk;
      maxD = Math.max(maxD, Math.abs(d));
    }
    const ct = lut.t.values;
    for (let i = 0; i < ct.length; i++) {
      const d = lut.tTarget[i] - ct[i];
      ct[i] += d * kk;
      maxD = Math.max(maxD, Math.abs(d));
    }
    lut.r.commit();
    lut.t.commit();
    if (maxD < 1e-3) {
      lut.r.set(lut.rTarget);
      lut.t.set(lut.tTarget);
      lut.settled = true;
    }
  }

  private updateWounds(nowMs: number, pending: Wound[] | undefined) {
    const u = this.material.uniforms;
    const scarLife = (u.uDecayTau.value as number) * 3;
    const life = Math.max(RIPPLE_LIFE, scarLife);
    const local = this.localWounds;
    let w = 0;
    for (let i = 0; i < local.length; i++) if ((nowMs - local[i].t) / 1000 < life) local[w++] = local[i];
    local.length = w;
    // merge store + local (dedupe by t/u/v), newest first
    const buf = this.woundBuf;
    buf.length = 0;
    for (let i = 0; i < local.length; i++) buf.push(local[i]);
    if (pending)
      for (let i = 0; i < pending.length; i++) {
        const x = pending[i];
        if ((nowMs - x.t) / 1000 >= life) continue;
        let dup = false;
        for (let j = 0; j < local.length; j++) {
          const l = local[j];
          if (l.t === x.t && Math.abs(l.u - x.u) < 1e-6 && Math.abs(l.v - x.v) < 1e-6) {
            dup = true;
            break;
          }
        }
        if (!dup) buf.push(x);
      }
    buf.sort(byNewest);
    const n = Math.min(buf.length, MAX_WOUNDS);
    const arr = u.uWounds.value as Vector4[];
    const str = u.uWoundStrength.value as Float32Array;
    for (let i = 0; i < n; i++) {
      const x = buf[i];
      uvInto(x.u, x.v, arr[i]);
      arr[i].w = Math.max(0, (nowMs - x.t) / 1000);
      str[i] = clamp01(x.strength ?? 1);
    }
    u.uWoundCount.value = n;
  }

  /** Dev/QA snapshot of the eased lens state. */
  debug() {
    return {
      L: Array.from(this.lens.L, (x) => +x.toFixed(3)),
      R: Array.from(this.lens.R, (x) => +x.toFixed(3)),
      ov: Array.from(this.lens.ov, (x) => +x.toFixed(3)),
      compare: +this.lens.compare.toFixed(3),
      reveal: this.lens.reveal,
      embryo: +this.c.embryo.toFixed(3),
      presence: {
        seed: +this.seedSlot.presence.toFixed(3),
        skin: +this.skinSlot.presence.toFixed(3),
        tissue: +this.tissueSlot.presence.toFixed(3),
        mask: +this.maskSlot.presence.toFixed(3),
      },
      soma: +this.c.soma.toFixed(3),
      irid: +this.c.irid.toFixed(3),
      links: this.linkCount,
      scars: this.material.uniforms.uScarCount.value as number,
      nuclei: this.material.uniforms.uNucleiCount.value as number,
      age: +this.age.toFixed(3),
      entangle: +this.entangle.toFixed(3),
      wipeX: +this.wipeX.toFixed(3),
    };
  }

  dispose() {
    this.material.dispose();
    this.nucleiMaterial.dispose();
    this.nucleiGeometry.dispose();
    this.sparksMaterial.dispose();
    this.sparksGeometry.dispose();
    this.linksMaterial.dispose();
    this.linksGeometry.dispose();
    this.linkNodesMaterial.dispose();
    this.linkNodesGeometry.dispose();
    this.shellsMaterial.dispose();
    this.shellsGeometry.dispose();
    this.soma.dispose();
    this.relief.dispose();
    this.lut.r.dispose();
    this.lut.t.dispose();
    this.seedSlot.dispose();
    this.skinSlot.dispose();
    this.tissueSlot.dispose();
    this.maskSlot.dispose();
    this.neutral.dispose();
  }
}
