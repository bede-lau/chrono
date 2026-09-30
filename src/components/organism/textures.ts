/**
 * GPU texture helpers for the organism. OWNER: viewport agent.
 */
import {
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  FloatType,
  HalfFloatType,
  ImageLoader,
  LinearFilter,
  NoColorSpace,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
  type WebGLRenderer,
  type Wrapping,
} from "three";

/** Float LUTs need OES_texture_float_linear for LINEAR filtering; otherwise fall back to half floats. */
export function floatLinearSupported(gl: WebGLRenderer): boolean {
  try {
    return gl.extensions.has("OES_texture_float_linear");
  } catch {
    return false;
  }
}

/**
 * Single-channel float texture (R32F, or R16F fallback) with LINEAR filtering.
 * `wrapS` Repeat for periodic axes (LUT phase, soma longitude), T always clamped.
 */
export class ScalarTexture {
  readonly texture: DataTexture;
  readonly width: number;
  readonly height: number;
  private readonly half: boolean;
  private readonly f32: Float32Array;
  private readonly u16: Uint16Array | null;

  constructor(width: number, height: number, useFloat: boolean, wrapS: Wrapping = RepeatWrapping, init = 0) {
    this.width = width;
    this.height = height;
    this.half = !useFloat;
    this.f32 = new Float32Array(width * height).fill(init);
    this.u16 = this.half ? new Uint16Array(width * height) : null;
    const data = this.half ? this.u16! : this.f32;
    const tex = new DataTexture(data, width, height, RedFormat, this.half ? HalfFloatType : FloatType);
    tex.wrapS = wrapS;
    tex.wrapT = ClampToEdgeWrapping;
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearFilter;
    tex.generateMipmaps = false;
    tex.flipY = false;
    tex.unpackAlignment = 1;
    this.texture = tex;
    this.commit();
  }

  /** Live CPU-side values (edit, then commit()). */
  get values(): Float32Array {
    return this.f32;
  }

  set(src: ArrayLike<number>) {
    const n = Math.min(src.length, this.f32.length);
    for (let i = 0; i < n; i++) this.f32[i] = Number.isFinite(src[i]) ? src[i] : 0;
    this.commit();
  }

  commit() {
    if (this.u16) {
      for (let i = 0; i < this.f32.length; i++) this.u16[i] = DataUtils.toHalfFloat(this.f32[i]);
    }
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
  }
}

/** 1x1 neutral RGBA texture so samplers are never unbound. */
export function solidTexture(r: number, g: number, b: number, a = 255): DataTexture {
  const t = new DataTexture(new Uint8Array([r, g, b, a]), 1, 1, RGBAFormat, UnsignedByteType);
  t.colorSpace = SRGBColorSpace;
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

const loader = new ImageLoader();
loader.setCrossOrigin("anonymous");

/** Load an artifact image (data:, blob: or /specimens/... URL). */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, (err) => reject(err));
  });
}

/**
 * Wrap a loaded image as a LINEAR-filtered, u-periodic texture. Colour artifacts are sRGB; data images (the wound
 * mask) are raw (`srgb = false`) so the shader reads the exact values sent to the engine.
 * Images keep flipY (row 0 = top = north pole at uv.y = 1).
 */
export function textureFromImage(img: HTMLImageElement, srgb = true): Texture {
  const t = new Texture(img);
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  t.wrapS = RepeatWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** Load an artifact image as an sRGB texture. */
export function loadImageTexture(url: string): Promise<Texture> {
  return loadImage(url).then((img) => textureFromImage(img, true));
}

export function textureSize(t: Texture): [number, number] {
  const img = t.image as { width?: number; height?: number } | undefined;
  return [Math.max(1, img?.width ?? 1), Math.max(1, img?.height ?? 1)];
}

/** Read RGBA8 pixels of a loaded image (for CPU-side analysis such as the colony relief). */
export function imagePixels(image: unknown): { data: Uint8ClampedArray; width: number; height: number } | null {
  const img = image as CanvasImageSource & { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number };
  const w = img?.naturalWidth || img?.width || 0;
  const h = img?.naturalHeight || img?.height || 0;
  if (!w || !h || typeof document === "undefined") return null;
  try {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
  } catch {
    return null;
  }
}

/** Load an image and return its pixels. */
export function loadImagePixels(url: string): Promise<{ data: Uint8ClampedArray; width: number; height: number } | null> {
  return new Promise((resolve) => {
    loader.load(
      url,
      (img) => resolve(imagePixels(img)),
      undefined,
      () => resolve(null),
    );
  });
}
