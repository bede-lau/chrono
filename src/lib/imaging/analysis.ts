/** Tissue analysis: luma downsampling + metrics used to derive shader params. OWNER: imaging agent. */
import type { RGBAImage } from "./index";

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

function luma255(r: number, g: number, b: number): number {
  return LUMA_R * r + LUMA_G * g + LUMA_B * b;
}

/** Downsample luminance to an N x N grid, normalised 0..1 (for blur-core-v1 `values`). */
export function lumaGrid(img: RGBAImage, n: number): number[][] {
  const { width, height, data } = img;
  const grid: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));

  for (let gy = 0; gy < n; gy++) {
    const y0 = Math.floor((gy * height) / n);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * height) / n));
    for (let gx = 0; gx < n; gx++) {
      const x0 = Math.floor((gx * width) / n);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * width) / n));

      let sum = 0;
      let count = 0;
      for (let y = Math.min(y0, height - 1); y < y1 && y < height; y++) {
        for (let x = Math.min(x0, width - 1); x < x1 && x < width; x++) {
          const idx = (y * width + x) * 4;
          sum += luma255(data[idx], data[idx + 1], data[idx + 2]);
          count++;
        }
      }
      grid[gy][gx] = count > 0 ? sum / count / 255 : 0;
    }
  }

  // Min-max normalise, guarding constant images (flat colony/tissue) to a
  // neutral mid-grey field rather than dividing by a zero range.
  let min = Infinity;
  let max = -Infinity;
  for (const row of grid) {
    for (const value of row) {
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  const range = max - min;
  if (range < 1e-9) {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) grid[y][x] = 0.5;
  } else {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) grid[y][x] = (grid[y][x] - min) / range;
  }

  return grid;
}

/** RGB (0..1) -> {hue 0..1, saturation 0..1} using the standard HSL formulas. */
function rgbToHueSat(r: number, g: number, b: number): { h: number; s: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return { h: 0, s: 0 };
  const l = (max + min) / 2;
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h /= 6;
  return { h, s };
}

/**
 * Tissue metrics used to derive Entanglement Shader params.
 *
 * - entropy: Shannon entropy (bits, 0..8) of the 256-bin luminance histogram.
 * - meanLuma: mean luminance, 0..1.
 * - hueSkew: circular mean hue, expressed as an offset from 0.5 turn (the
 *   180 degree/cyan-ish point on the hue wheel), weighted by each pixel's
 *   saturation so achromatic pixels don't vote. Concretely: treat hue as an
 *   angle theta = hue * 2*pi, take the saturation-weighted circular mean
 *   angle via atan2(sum(sin*sat), sum(cos*sat)), then measure how far that
 *   mean angle sits from pi (= hue 0.5) and normalise by pi, giving a signed
 *   value in -1..1 (0 = mean hue is exactly the 0.5-turn reference; +/-1 = a
 *   full half-turn away from it, i.e. a hue near 0/1). Fully achromatic
 *   images (saturation sums to ~0) report hueSkew = 0.
 */
export function imageMetrics(img: RGBAImage): { entropy: number; meanLuma: number; hueSkew: number } {
  const { width, height, data } = img;
  const total = width * height;
  const hist = new Array<number>(256).fill(0);
  let sumLuma = 0;
  let sumSin = 0;
  let sumCos = 0;
  let sumSat = 0;

  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];

    const luma = luma255(r, g, b);
    sumLuma += luma;
    const bin = Math.min(255, Math.max(0, Math.round(luma)));
    hist[bin]++;

    const { h, s } = rgbToHueSat(r / 255, g / 255, b / 255);
    const theta = h * Math.PI * 2;
    sumSin += Math.sin(theta) * s;
    sumCos += Math.cos(theta) * s;
    sumSat += s;
  }

  let entropy = 0;
  for (const count of hist) {
    if (count > 0) {
      const p = count / total;
      entropy -= p * Math.log2(p);
    }
  }

  const meanLuma = sumLuma / total / 255;

  let hueSkew = 0;
  if (sumSat > 1e-6) {
    const meanAngle = Math.atan2(sumSin, sumCos); // -pi..pi
    let offset = meanAngle - Math.PI;
    offset = (((offset + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI; // wrap to (-pi,pi]
    hueSkew = offset / Math.PI;
  }

  return { entropy, meanLuma, hueSkew };
}
