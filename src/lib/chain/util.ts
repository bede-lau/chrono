/** Small isomorphic helpers for the chain (no Node or DOM-only APIs). */

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const round = (x: number, d = 3) => {
  const p = 10 ** d;
  return Math.round(x * p) / p;
};
/** Fixed-decimals string, with explicit sign when `signed`. */
export const fx = (x: number, d = 2, signed = false) => `${signed && x >= 0 ? "+" : ""}${x.toFixed(d)}`;
export const hex2 = (b: number) => `0x${b.toString(16).padStart(2, "0")}`;
export const hex8 = (n: number) => `0x${(n >>> 0).toString(16).padStart(8, "0")}`;

/** Big-endian uint32 from 4 bytes starting at `i`. */
export function uint32BE(bytes: number[], i: number): number {
  return (((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0) as number;
}

export function bytesToHex(bytes: ArrayLike<number>): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += (bytes[i] & 0xff).toString(16).padStart(2, "0");
  return s;
}

export function hexToBytes(hex: string): number[] {
  const clean = hex.replace(/[^0-9a-f]/gi, "");
  const out: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
  return out;
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}

/** Round every float in a (nested) array to `sig` significant digits — keeps manifests small. */
export function roundSig(x: number, sig = 5): number {
  if (!Number.isFinite(x) || x === 0) return x || 0;
  const d = sig - Math.ceil(Math.log10(Math.abs(x)));
  const p = 10 ** Math.max(0, Math.min(12, d));
  return Math.round(x * p) / p;
}

export function flattenNumbers(v: unknown, out: number[] = []): number[] {
  if (Array.isArray(v)) for (const x of v) flattenNumbers(x, out);
  else if (typeof v === "number") out.push(v);
  else if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) out.push(Number(v));
  return out;
}

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  format: number; // 1 = PCM, 3 = float
  dataBytes: number;
  durationSec: number;
}

/** Parse a RIFF/WAVE header (walks chunks). Throws if the bytes are not a valid WAV. */
export function parseWav(bytes: Uint8Array): WavInfo {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (bytes.byteLength < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a RIFF/WAVE file");
  let o = 12;
  let fmt: Omit<WavInfo, "dataBytes" | "durationSec"> | null = null;
  let dataBytes = -1;
  while (o + 8 <= bytes.byteLength) {
    const id = tag(o);
    const size = dv.getUint32(o + 4, true);
    if (id === "fmt ") {
      fmt = {
        format: dv.getUint16(o + 8, true),
        channels: dv.getUint16(o + 10, true),
        sampleRate: dv.getUint32(o + 12, true),
        bitsPerSample: dv.getUint16(o + 22, true),
      };
    } else if (id === "data") {
      dataBytes = Math.min(size, bytes.byteLength - (o + 8));
      break;
    }
    o += 8 + size + (size & 1);
  }
  if (!fmt) throw new Error("WAV has no fmt chunk");
  if (dataBytes < 0) throw new Error("WAV has no data chunk");
  if (!fmt.sampleRate || !fmt.channels || !fmt.bitsPerSample) throw new Error("WAV fmt chunk is invalid");
  const durationSec = dataBytes / (fmt.sampleRate * fmt.channels * (fmt.bitsPerSample / 8));
  return { ...fmt, dataBytes, durationSec };
}

/** Mean |ΔL| between two same-size RGBA8 images (Rec.709 luma, 0..1). */
export function meanLumaDelta(
  a: { width: number; height: number; data: Uint8ClampedArray },
  b: { width: number; height: number; data: Uint8ClampedArray },
): number | undefined {
  if (a.width !== b.width || a.height !== b.height) return undefined;
  let s = 0;
  const n = a.width * a.height;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const la = 0.2126 * a.data[j] + 0.7152 * a.data[j + 1] + 0.0722 * a.data[j + 2];
    const lb = 0.2126 * b.data[j] + 0.7152 * b.data[j + 1] + 0.0722 * b.data[j + 2];
    s += Math.abs(la - lb);
  }
  return s / n / 255;
}

/** YIQ hue rotation + chroma gain on an RGBA8 image (returns a new image). */
export function retint(
  img: { width: number; height: number; data: Uint8ClampedArray },
  hueDeg: number,
  sat: number,
): { width: number; height: number; data: Uint8ClampedArray } {
  const d = new Uint8ClampedArray(img.data);
  const a = (hueDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const I = 0.596 * r - 0.274 * g - 0.322 * b;
    const Q = 0.211 * r - 0.523 * g + 0.312 * b;
    const I2 = (I * c - Q * s) * sat;
    const Q2 = (I * s + Q * c) * sat;
    d[i] = y + 0.956 * I2 + 0.621 * Q2;
    d[i + 1] = y - 0.272 * I2 - 0.647 * Q2;
    d[i + 2] = y - 1.106 * I2 + 1.703 * Q2;
  }
  return { width: img.width, height: img.height, data: d };
}

/** Value at quantile q (0..1) of an unsorted array. */
export function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
}
