/**
 * PNG codec + isomorphic base64 data URLs. OWNER: imaging agent.
 * Pure Node+browser: no Buffer, no DOM/canvas. Uses fast-png for the actual
 * DEFLATE/zlib work and global atob/btoa (available in Node 20+ and browsers)
 * for base64.
 */
import { decode as fastDecode, encode as fastEncode, convertIndexedToRgb } from "fast-png";
import type { DecodedPng, PngDataArray } from "fast-png";
import type { RGBAImage } from "./index";

/** Encode RGBA -> PNG bytes. */
export function encodePng(img: RGBAImage): Uint8Array {
  return fastEncode({
    width: img.width,
    height: img.height,
    data: img.data,
    channels: 4,
    depth: 8,
  });
}

/**
 * Reads a single colour/alpha sample from a decoded PNG's raw sample plane.
 * Handles the two shapes fast-png can hand back:
 *  - channels === 1 (grayscale, non-palette) at depth < 8: bit-packed, MSB first,
 *    each row padded to a byte boundary (this is the only case where depth < 8
 *    is legal outside of palette images, which are unpacked separately below).
 *  - everything else (depth 8 or 16, 1/2/3/4 channels): a flat, byte-aligned
 *    array indexed as (y*width + x) * channels + c.
 */
function sampleAt(
  data: PngDataArray,
  width: number,
  channels: number,
  depth: number,
  x: number,
  y: number,
  c: number,
): number {
  if (channels === 1 && depth < 8) {
    const bytesPerLine = Math.ceil((depth * width) / 8);
    const bitPos = x * depth;
    const byteIndex = y * bytesPerLine + (bitPos >> 3);
    const bitOffset = 8 - depth - (bitPos % 8);
    const mask = (1 << depth) - 1;
    return (data[byteIndex] >> bitOffset) & mask;
  }
  const idx = (y * width + x) * channels + c;
  return data[idx];
}

/** Scales a sample of the given bit depth up to the 0..255 range. */
function scaleTo8(sample: number, depth: number): number {
  if (depth === 8) return sample;
  if (depth === 16) return sample >> 8;
  const maxVal = (1 << depth) - 1;
  return Math.round((sample * 255) / maxVal);
}

/** Decode PNG bytes -> RGBA8. Normalises gray, gray+alpha, RGB, RGBA, palette and 16-bit inputs. */
export function decodePng(bytes: Uint8Array): RGBAImage {
  const decoded: DecodedPng = fastDecode(bytes);
  const { width, height, channels, depth } = decoded;
  const out = new Uint8ClampedArray(width * height * 4);

  if (decoded.palette && decoded.palette.length > 0) {
    // Indexed colour: convertIndexedToRgb unpacks sub-byte indices and expands
    // through the palette, producing RGB (3) or RGBA (4) bytes per pixel
    // depending on whether a tRNS chunk supplied per-entry alpha.
    const rgb = convertIndexedToRgb(decoded);
    const stride = decoded.palette[0]?.length ?? 3;
    for (let p = 0; p < width * height; p++) {
      out[p * 4] = rgb[p * stride];
      out[p * 4 + 1] = rgb[p * stride + 1];
      out[p * 4 + 2] = rgb[p * stride + 2];
      out[p * 4 + 3] = stride === 4 ? rgb[p * stride + 3] : 255;
    }
    return { width, height, data: out };
  }

  const data = decoded.data;
  const trns = decoded.transparency;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      let r: number, g: number, b: number, a: number;
      if (channels === 1) {
        const s0 = sampleAt(data, width, channels, depth, x, y, 0);
        r = g = b = scaleTo8(s0, depth);
        a = trns && trns.length >= 1 && s0 === trns[0] ? 0 : 255;
      } else if (channels === 2) {
        const s0 = sampleAt(data, width, channels, depth, x, y, 0);
        const s1 = sampleAt(data, width, channels, depth, x, y, 1);
        r = g = b = scaleTo8(s0, depth);
        a = scaleTo8(s1, depth);
      } else if (channels === 3) {
        const s0 = sampleAt(data, width, channels, depth, x, y, 0);
        const s1 = sampleAt(data, width, channels, depth, x, y, 1);
        const s2 = sampleAt(data, width, channels, depth, x, y, 2);
        r = scaleTo8(s0, depth);
        g = scaleTo8(s1, depth);
        b = scaleTo8(s2, depth);
        a = trns && trns.length >= 3 && s0 === trns[0] && s1 === trns[1] && s2 === trns[2] ? 0 : 255;
      } else {
        const s0 = sampleAt(data, width, channels, depth, x, y, 0);
        const s1 = sampleAt(data, width, channels, depth, x, y, 1);
        const s2 = sampleAt(data, width, channels, depth, x, y, 2);
        const s3 = sampleAt(data, width, channels, depth, x, y, 3);
        r = scaleTo8(s0, depth);
        g = scaleTo8(s1, depth);
        b = scaleTo8(s2, depth);
        a = scaleTo8(s3, depth);
      }
      out[idx] = r;
      out[idx + 1] = g;
      out[idx + 2] = b;
      out[idx + 3] = a;
    }
  }
  return { width, height, data: out };
}

/** Bytes -> base64 without Buffer (chunked to stay well under call-stack/arg limits). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/** PNG bytes -> data: URL (isomorphic base64; works in Node 20+ and browsers). */
export function pngDataUrl(bytes: Uint8Array): string {
  return `data:image/png;base64,${bytesToBase64(bytes)}`;
}
