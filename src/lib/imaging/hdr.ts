/**
 * Radiance RGBE (.hdr) parser. OWNER: imaging agent. Pure, isomorphic (no Buffer).
 * Supports new-style adaptive RLE scanlines, old-style RLE repeat runs, and
 * flat/uncompressed scanlines. Header resolution line is `-Y H +X W`; per the
 * shader's GLSL contract, file row 0 maps straight to Lut row 0 (theta = 0) —
 * this parser does NOT flip vertically.
 */
import type { Lut } from "../chain/types";

const asciiDecoder = new TextDecoder("ascii");

/**
 * Reads one scanline of RGBE pixels into `out` ([r,g,b,e, r,g,b,e, ...],
 * length width*4). Returns the new byte offset.
 */
function readScanline(bytes: Uint8Array, pos0: number, width: number, out: Uint8Array): number {
  let pos = pos0;
  if (width >= 8 && width <= 0x7fff) {
    const r0 = bytes[pos];
    const g0 = bytes[pos + 1];
    const b0 = bytes[pos + 2];
    const e0 = bytes[pos + 3];
    if (r0 === 2 && g0 === 2 && ((b0 << 8) | e0) === width) {
      // New-style RLE: 4-byte marker, then each of R,G,B,E RLE-encoded
      // separately across `width` bytes for this scanline.
      pos += 4;
      for (let channel = 0; channel < 4; channel++) {
        let x = 0;
        while (x < width) {
          const count = bytes[pos++];
          if (count > 128) {
            const runLen = count - 128;
            const value = bytes[pos++];
            for (let i = 0; i < runLen; i++) out[x++ * 4 + channel] = value;
          } else {
            const runLen = count;
            for (let i = 0; i < runLen; i++) out[x++ * 4 + channel] = bytes[pos++];
          }
        }
      }
      return pos;
    }
  }
  return readFlatScanline(bytes, pos, width, out);
}

/** Flat/uncompressed scanline, with support for old-style repeat-previous-pixel runs (r=g=b=1, e=count). */
function readFlatScanline(bytes: Uint8Array, pos0: number, width: number, out: Uint8Array): number {
  let pos = pos0;
  let x = 0;
  let prevR = 0;
  let prevG = 0;
  let prevB = 0;
  let prevE = 0;
  while (x < width) {
    const r = bytes[pos++];
    const g = bytes[pos++];
    const b = bytes[pos++];
    const e = bytes[pos++];
    if (r === 1 && g === 1 && b === 1 && x > 0) {
      const runLen = e;
      for (let i = 0; i < runLen && x < width; i++) {
        out[x * 4] = prevR;
        out[x * 4 + 1] = prevG;
        out[x * 4 + 2] = prevB;
        out[x * 4 + 3] = prevE;
        x++;
      }
    } else {
      out[x * 4] = r;
      out[x * 4 + 1] = g;
      out[x * 4 + 2] = b;
      out[x * 4 + 3] = e;
      prevR = r;
      prevG = g;
      prevB = b;
      prevE = e;
      x++;
    }
  }
  return pos;
}

/** Parse Radiance .hdr (RGBE, RLE) -> Lut (R channel, as float; may exceed 1). */
export function parseHdrLut(bytes: Uint8Array): Lut {
  let pos = 0;

  function readLine(): string {
    const start = pos;
    while (pos < bytes.length && bytes[pos] !== 0x0a) pos++;
    const line = asciiDecoder.decode(bytes.subarray(start, pos));
    pos++; // skip the newline
    return line;
  }

  // Header: lines up to (and including) the first blank line.
  for (;;) {
    const line = readLine();
    if (line.length === 0) break;
  }

  const resLine = readLine().trim();
  const match = /^-Y\s+(\d+)\s+\+X\s+(\d+)/.exec(resLine);
  if (!match) {
    throw new Error(`parseHdrLut: unsupported resolution line "${resLine}"`);
  }
  const height = Number(match[1]);
  const width = Number(match[2]);

  const data = new Array<number>(width * height);
  const rgbeRow = new Uint8Array(width * 4);

  for (let y = 0; y < height; y++) {
    pos = readScanline(bytes, pos, width, rgbeRow);
    for (let x = 0; x < width; x++) {
      const r = rgbeRow[x * 4];
      const e = rgbeRow[x * 4 + 3];
      // Standard RGBE decode: value = mantissa * 2^(exponent - 128 - 8).
      data[y * width + x] = e === 0 ? 0 : r * Math.pow(2, e - 136);
    }
  }

  return { width, height, data };
}
