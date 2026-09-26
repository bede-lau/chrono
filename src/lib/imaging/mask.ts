/** Wound mask rendering for blur-v1. OWNER: imaging agent. Pure, isomorphic. */
import type { Wound } from "../chain/types";
import type { RGBAImage } from "./index";

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Wound mask for blur-v1 (same WxH as the image it masks). White = full
 * decoherence. Soft Gaussian discs at each wound (radius ~0.08-0.15 of width,
 * scaled by wound strength), u wraps horizontally (equirectangular longitude),
 * v does not (poles). Multiple wounds combine by max (not sum) so overlapping
 * touches don't blow out to solid white. `baseline` sets a floor everywhere so
 * the whole organism ages a little even where it wasn't touched.
 */
export function renderWoundMask(wounds: Wound[], width: number, height: number, baseline = 0): RGBAImage {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let py = 0; py < height; py++) {
    const v = (py + 0.5) / height;
    for (let px = 0; px < width; px++) {
      const u = (px + 0.5) / width;
      let value = baseline;

      for (const w of wounds) {
        const strength = clamp(w.strength, 0, 1);
        const radiusPx = (0.08 + 0.07 * strength) * width;
        const sigmaPx = radiusPx / 2;

        let dxPx = Math.abs(u - w.u) * width;
        dxPx = Math.min(dxPx, width - dxPx); // wrap horizontally (longitude)
        const dyPx = (v - w.v) * height; // no wrap vertically (poles)

        const d2 = dxPx * dxPx + dyPx * dyPx;
        const g = strength * Math.exp(-d2 / (2 * sigmaPx * sigmaPx));
        if (g > value) value = g;
      }

      value = clamp(value, 0, 1);
      const byte = Math.round(value * 255);
      const idx = (py * width + px) * 4;
      data[idx] = byte;
      data[idx + 1] = byte;
      data[idx + 2] = byte;
      data[idx + 3] = 255;
    }
  }

  return { width, height, data };
}
