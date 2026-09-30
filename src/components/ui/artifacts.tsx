"use client";
/**
 * Artifact previews of the Evolution view — one per engine, each showing the RELATION between what the engine
 * consumed and what it produced (skin + mask → tissue, brightness → shape, …). OWNER: ui-evolution agent.
 *
 * Image space = the organism's UV (docs/ROUND2.md §1): x = u (longitude, wraps), y = 1 − v (v = 1 = north = TOP row).
 * Small artifacts (21–64 px) are resampled with Catmull-Rom (u wraps, v clamps) so they read smooth, the way the
 * shader samples them; only deliberately discrete data (the genome bits) stays crisp.
 *
 * Linked probe: hovering an image-space preview sets `probe {u, v, source: "panel"}` (the blob draws a ring there);
 * any probe draws a thin crosshair on every other image-space preview (Soma also rings the antipode, Membrane marks
 * the LUT texel the blob samples at θ / phase).
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { ArrowDown, ArrowRight, ChevronRight, Plus } from "lucide-react";
import type { BlochVector, Lut, Probe, SomaArtifact, Specimen, StageId, Wound } from "@/lib/chain/types";
import { MASK_BASELINE } from "@/lib/chain/pipeline";
import { useChrono } from "@/lib/store";
import { lumaGrid, renderWoundMask } from "@/lib/imaging";
import { woundSigma } from "@/lib/imaging/mask";
import { Waveform } from "./deps";
import { blochColor, formatNumber } from "./format";
import { cx } from "./primitives";

/* ================================================================ rasters */

type Px = Uint8ClampedArray<ArrayBuffer>;
/** RGBA8 pixels, row 0 = top. */
interface Rgba {
  w: number;
  h: number;
  data: Px;
}
/** Writes one colour-mapped RGBA pixel at `o`. */
type ColorMap = (v: number, out: Px, o: number) => void;

const TARGET = 256;
const upscale = (w: number, h: number) => Math.max(1, Math.round(TARGET / Math.max(w, h)));
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Catmull-Rom taps + weights resampling `n` samples to `N` (pixel centres aligned). */
function taps(n: number, N: number, wrap: boolean) {
  const idx = new Int32Array(N * 4);
  const wt = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const f = ((i + 0.5) / N) * n - 0.5;
    const i0 = Math.floor(f);
    const t = f - i0;
    const t2 = t * t;
    const t3 = t2 * t;
    const w = [-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1, -1.5 * t3 + 2 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2];
    for (let k = 0; k < 4; k++) {
      const j = i0 - 1 + k;
      idx[i * 4 + k] = wrap ? ((j % n) + n) % n : j < 0 ? 0 : j >= n ? n - 1 : j;
      wt[i * 4 + k] = w[k];
    }
  }
  return { idx, wt };
}

/** Separable Catmull-Rom resample of `ch` channels read at `stride`; x wraps when `wrapX` (longitude, LUT phase), y clamps. */
function resample(src: ArrayLike<number>, w: number, h: number, ch: number, stride: number, W: number, H: number, wrapX: boolean): Float32Array {
  const tx = taps(w, W, wrapX);
  const ty = taps(h, H, false);
  const mid = new Float32Array(W * h * ch);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < W; x++)
      for (let c = 0; c < ch; c++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += tx.wt[x * 4 + k] * src[(y * w + tx.idx[x * 4 + k]) * stride + c];
        mid[(y * W + x) * ch + c] = s;
      }
  const out = new Float32Array(W * H * ch);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      for (let c = 0; c < ch; c++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += ty.wt[y * 4 + k] * mid[(ty.idx[y * 4 + k] * W + x) * ch + c];
        out[(y * W + x) * ch + c] = s;
      }
  return out;
}

function smoothRgba(img: Rgba, wrapX = true): Rgba {
  const s = upscale(img.w, img.h);
  const W = img.w * s;
  const H = img.h * s;
  const f = resample(img.data, img.w, img.h, 3, 4, W, H, wrapX);
  const data: Px = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = f[i * 3];
    data[i * 4 + 1] = f[i * 3 + 1];
    data[i * 4 + 2] = f[i * 3 + 2];
    data[i * 4 + 3] = 255;
  }
  return { w: W, h: H, data };
}

function smoothField(field: ArrayLike<number>, w: number, h: number, map: ColorMap, wrapX = true): Rgba {
  const s = upscale(w, h);
  const W = w * s;
  const H = h * s;
  const f = resample(field, w, h, 1, 1, W, H, wrapX);
  const data: Px = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) map(f[i], data, i * 4);
  return { w: W, h: H, data };
}

/** Upsampled rasters, keyed by their source object (pixels or data array) + variant. */
const rasterCache = new WeakMap<object, Map<string, Rgba>>();
function cachedRaster(key: object, variant: string, make: () => Rgba): Rgba {
  let m = rasterCache.get(key);
  if (!m) rasterCache.set(key, (m = new Map()));
  let r = m.get(variant);
  if (!r) m.set(variant, (r = make()));
  return r;
}

/** Decoded pixels per URL (same-origin /specimens/…, blob: and data: URLs never taint the canvas). */
const pixelCache = new Map<string, Promise<Rgba>>();
function loadPixels(url: string): Promise<Rgba> {
  const hit = pixelCache.get(url);
  if (hit) return hit;
  const p = new Promise<Rgba>((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const g = c.getContext("2d", { willReadFrequently: true });
        if (!g) throw new Error("2d context unavailable");
        g.drawImage(img, 0, 0);
        resolve({ w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data });
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error(`could not decode ${url.slice(0, 60)}`));
    img.src = url;
  });
  pixelCache.set(url, p);
  p.catch(() => pixelCache.delete(url));
  if (pixelCache.size > 48) pixelCache.delete(pixelCache.keys().next().value as string);
  return p;
}

function usePixels(url?: string): Rgba | null {
  const [got, setGot] = useState<{ url: string; px: Rgba } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    loadPixels(url).then(
      (px) => live && setGot({ url, px }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [url]);
  return got && got.url === url ? got.px : null;
}

/** Smooth, display-ready raster of an image URL. */
function useSmoothImage(url?: string): Rgba | null {
  const px = usePixels(url);
  return useMemo(() => (px ? cachedRaster(px, "smooth", () => smoothRgba(px)) : null), [px]);
}

/* ---------------------------------------------------------------- colour maps */

function grayMap(lo: number, hi: number, gamma = 0.9): ColorMap {
  const span = hi - lo || 1;
  return (v, out, o) => {
    const l = 10 + 238 * Math.pow(clamp01((v - lo) / span), gamma);
    out[o] = l;
    out[o + 1] = l;
    out[o + 2] = l;
    out[o + 3] = 255;
  };
}

/**
 * Soma displacement colours: warm = the body bulges OUTWARD, cool = it dents INWARD, dark = unchanged.
 * Exported so the viewport's soma overlay can use the same pair.
 */
export const SOMA_COLORS = {
  zero: [24, 24, 28],
  outward: { mid: [230, 112, 60], end: [255, 216, 172] },
  inward: { mid: [64, 134, 230], end: [184, 226, 255] },
} as const;

const mix = (a: readonly number[], b: readonly number[], t: number, k: number) => a[k] + (b[k] - a[k]) * t;
const KNEE = 0.68;
const divergingMap: ColorMap = (d, out, o) => {
  const t = Math.pow(clamp01(Math.abs(d)), 1.15);
  const ramp = d >= 0 ? SOMA_COLORS.outward : SOMA_COLORS.inward;
  for (let k = 0; k < 3; k++)
    out[o + k] = t < KNEE ? mix(SOMA_COLORS.zero, ramp.mid, t / KNEE, k) : mix(ramp.mid, ramp.end, (t - KNEE) / (1 - KNEE), k);
  out[o + 3] = 255;
};
const rgb = (c: readonly number[]) => `rgb(${c[0]} ${c[1]} ${c[2]})`;
// |d| reaching the knee colour: KNEE^(1/1.15) ≈ 0.72 → 14 % / 86 % along the −1…1 bar
const SOMA_LEGEND = `linear-gradient(to right, ${rgb(SOMA_COLORS.inward.end)}, ${rgb(SOMA_COLORS.inward.mid)} 14%, ${rgb(SOMA_COLORS.zero)} 50%, ${rgb(SOMA_COLORS.outward.mid)} 86%, ${rgb(SOMA_COLORS.outward.end)})`;

/**
 * The displacement the blob actually applies (mirrors `somaField` in organism/artifacts.ts, without its texture
 * resample/flip): log-compress blur-core's heavy-tailed output, centre on the mean, scale to max |d| = 1.
 */
function somaDisplacement(soma: SomaArtifact): Float32Array | null {
  const n = soma.size > 0 ? soma.size : Math.round(Math.sqrt(soma.grid.length));
  if (n < 2 || soma.grid.length < n * n) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n * n; i++) {
    const v = soma.grid[i];
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) return null;
  const span = hi - lo > 1e-9 ? hi - lo : 1;
  const EPS = 0.004;
  const LOGN = Math.log(1 + 1 / EPS);
  const out = new Float32Array(n * n);
  let mean = 0;
  for (let i = 0; i < n * n; i++) {
    const v = soma.grid[i];
    out[i] = Math.log(1 + Math.max(0, (Number.isFinite(v) ? v : lo) - lo) / span / EPS) / LOGN;
    mean += out[i];
  }
  mean /= n * n;
  let m = 0;
  for (let i = 0; i < n * n; i++) {
    out[i] -= mean;
    m = Math.max(m, Math.abs(out[i]));
  }
  if (m > 1e-6) for (let i = 0; i < n * n; i++) out[i] /= m;
  return out;
}

/** The exact luminance grid sent to blur-core (`params.values`), flattened; null when absent. */
function sentGrid(values: unknown): { n: number; m: number; data: number[] } | null {
  if (!Array.isArray(values) || !values.length || !Array.isArray(values[0])) return null;
  const n = values.length;
  const m = (values[0] as unknown[]).length;
  const data: number[] = [];
  for (const row of values as unknown[][]) for (let x = 0; x < m; x++) data.push(Number(row[x]) || 0);
  return data.length === n * m ? { n, m, data } : null;
}

/* ================================================================ frames + probe */

function Frame({ children, className, ...rest }: ComponentProps<"div">) {
  return (
    <div className={cx("relative overflow-hidden rounded-[9px] bg-white/[0.035] shadow-[inset_0_0_0_1px_var(--hairline)]", className)} {...rest}>
      {children}
    </div>
  );
}

function RasterCanvas({ raster, label }: { raster: Rgba | null; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c || !raster) return;
    if (c.width !== raster.w) c.width = raster.w;
    if (c.height !== raster.h) c.height = raster.h;
    c.getContext("2d")?.putImageData(new ImageData(raster.data, raster.w, raster.h), 0, 0);
  }, [raster]);
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      className={cx("absolute inset-0 block size-full transition-opacity duration-300 ease-out", raster ? "opacity-100" : "opacity-0")}
    />
  );
}

const f1 = (n: number) => Math.round(n * 100) / 100;

/** Crosshair with a gap and a small ring at (x, y) in 0..100 frame units. */
function crossPath(x: number, y: number) {
  const g = 5;
  const r = 2.2;
  return `M0 ${f1(y)}H${f1(x - g)}M${f1(x + g)} ${f1(y)}H100M${f1(x)} 0V${f1(y - g)}M${f1(x)} ${f1(y + g)}V100M${f1(x + r)} ${f1(y)}A${r} ${r} 0 1 0 ${f1(x - r)} ${f1(y)}A${r} ${r} 0 1 0 ${f1(x + r)} ${f1(y)}`;
}
function ringPath(x: number, y: number, r: number) {
  return `M${f1(x + r)} ${f1(y)}A${r} ${r} 0 1 0 ${f1(x - r)} ${f1(y)}A${r} ${r} 0 1 0 ${f1(x + r)} ${f1(y)}`;
}

const STROKE = { vectorEffect: "non-scaling-stroke" as const, fill: "none", strokeLinecap: "round" as const };

/**
 * Square image-space frame taking part in the linked probe.
 * Hover → setProbe(panel); any probe → crosshair here (hidden on the frame under the pointer, which shows the cursor).
 * Redraws are imperative (store subscription → SVG `d`), so hovering never re-renders React or touches layout.
 */
function ProbeFrame({ raster, label, overlay, antipode, className }: { raster: Rgba | null; label: string; overlay?: ReactNode; antipode?: boolean; className?: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const cross = useRef<SVGGElement>(null);
  const anti = useRef<SVGGElement>(null);
  const hovered = useRef(false);
  const raf = useRef(0);
  const pointer = useRef<{ x: number; y: number } | null>(null);

  const draw = useCallback((p: Probe | null) => {
    const g = cross.current;
    if (!g) return;
    const show = !!p && !(p.source === "panel" && hovered.current);
    g.style.display = show ? "" : "none";
    if (anti.current) anti.current.style.display = show ? "" : "none";
    if (!show || !p) return;
    const d = crossPath(p.u * 100, (1 - p.v) * 100);
    g.querySelectorAll("path").forEach((el) => el.setAttribute("d", d));
    if (anti.current) {
      // antipode of (u, v) is (u + ½ mod 1, 1 − v) → image row y = v
      const ad = ringPath(((p.u + 0.5) % 1) * 100, p.v * 100, 3.4);
      anti.current.querySelectorAll("path").forEach((el) => el.setAttribute("d", ad));
    }
  }, []);

  useEffect(() => {
    draw(useChrono.getState().probe);
    const off = useChrono.subscribe((s, prev) => {
      if (s.probe !== prev.probe) draw(s.probe);
    });
    return () => {
      off();
      cancelAnimationFrame(raf.current);
      if (hovered.current && useChrono.getState().probe?.source === "panel") useChrono.getState().setProbe(null);
    };
  }, [draw]);

  const flush = () => {
    raf.current = 0;
    const el = frame.current;
    const pt = pointer.current;
    if (!el || !pt) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const u = Math.min(0.9999, clamp01((pt.x - r.left) / r.width));
    const y = clamp01((pt.y - r.top) / r.height);
    useChrono.getState().setProbe({ u, v: 1 - y, source: "panel" });
  };
  const leave = () => {
    hovered.current = false;
    pointer.current = null;
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    if (useChrono.getState().probe?.source === "panel") useChrono.getState().setProbe(null);
  };

  return (
    <Frame
      ref={frame}
      className={cx("aspect-square cursor-crosshair", className)}
      onPointerEnter={() => {
        hovered.current = true;
        draw(useChrono.getState().probe);
      }}
      onPointerMove={(e) => {
        pointer.current = { x: e.clientX, y: e.clientY };
        if (!raf.current) raf.current = requestAnimationFrame(flush);
      }}
      onPointerLeave={leave}
      onPointerCancel={leave}
    >
      <RasterCanvas raster={raster} label={label} />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
        {overlay}
        {antipode && (
          <g ref={anti} style={{ display: "none" }}>
            <path {...STROKE} stroke="rgb(0 0 0 / 0.5)" strokeWidth={3} />
            <path {...STROKE} stroke="rgb(255 255 255 / 0.9)" strokeWidth={1} strokeDasharray="2 2.5" />
          </g>
        )}
        <g ref={cross} style={{ display: "none" }}>
          <path {...STROKE} stroke="rgb(0 0 0 / 0.38)" strokeWidth={2.5} />
          <path {...STROKE} stroke="rgb(255 255 255 / 0.8)" strokeWidth={1} />
        </g>
      </svg>
    </Frame>
  );
}

/* ---------------------------------------------------------------- static overlays */

/** Half-maximum contour of each wound's great-circle Gaussian, drawn on the equirect mask (u wraps, v = 1 top). */
function WoundRings({ wounds }: { wounds: Wound[] }) {
  const k = Math.sqrt(2 * Math.log(2));
  return (
    <>
      {wounds.map((w, i) => {
        const a = k * woundSigma(w.strength);
        const lat = (w.v - 0.5) * Math.PI;
        const rx = Math.min(48, ((a / (2 * Math.PI)) * 100) / Math.max(0.22, Math.cos(lat)));
        const ry = (a / Math.PI) * 100;
        const cx0 = w.u * 100;
        const cy = (1 - w.v) * 100;
        const xs = [cx0, ...(cx0 - rx < 0 ? [cx0 + 100] : []), ...(cx0 + rx > 100 ? [cx0 - 100] : [])];
        return (
          <g key={i}>
            {xs.map((x) => (
              <Fragment key={x}>
                <ellipse cx={x} cy={cy} rx={rx} ry={ry} {...STROKE} stroke="rgb(0 0 0 / 0.35)" strokeWidth={2.5} />
                <ellipse cx={x} cy={cy} rx={rx} ry={ry} {...STROKE} stroke="rgb(255 255 255 / 0.7)" strokeWidth={1} />
              </Fragment>
            ))}
            <circle cx={cx0} cy={cy} r={1.1} fill="rgb(255 255 255 / 0.9)" />
          </g>
        );
      })}
    </>
  );
}

/** Where each measured nucleus lands on the colony seed (colour-sphere convention of imaging/colony.ts). */
function nucleusXY(b: BlochVector) {
  const r = Math.hypot(b.x, b.y, b.z);
  const theta = r > 1e-9 ? Math.acos(Math.max(-1, Math.min(1, b.z / r))) : 0;
  const phi = Math.atan2(b.y, b.x);
  return { x: ((phi + Math.PI) / (2 * Math.PI)) * 100, y: (theta / Math.PI) * 100, r: Math.min(1, r) };
}

/** Thin rings where each measured nucleus sits on the seed: every ring is the centre of one cell. */
function NucleusMarks({ bloch }: { bloch: BlochVector[] }) {
  return (
    <>
      {bloch.map((b, i) => {
        const p = nucleusXY(b);
        const d = ringPath(p.x, p.y, 3);
        return (
          <g key={i}>
            <path d={d} {...STROKE} stroke="rgb(0 0 0 / 0.4)" strokeWidth={2.5} />
            <path d={d} {...STROKE} stroke="rgb(255 255 255 / 0.85)" strokeWidth={1} />
          </g>
        );
      })}
    </>
  );
}

/**
 * Each nucleus coloured like the cell it grew in the seed (3×3 mean around its centre). Seeds can be hue-rotated
 * for Atlas' upload verifier, so the raw Bloch hue would not match the picture; falls back to it until decoded.
 */
function cellColors(px: Rgba | null, bloch: BlochVector[]): string[] {
  return bloch.map((b) => {
    if (!px) return blochColor(b);
    const p = nucleusXY(b);
    const cx = Math.min(px.w - 1, Math.floor((p.x / 100) * px.w));
    const cy = Math.min(px.h - 1, Math.floor((p.y / 100) * px.h));
    const sum = [0, 0, 0];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = (cx + dx + px.w) % px.w;
        const y = Math.max(0, Math.min(px.h - 1, cy + dy));
        for (let k = 0; k < 3; k++) sum[k] += px.data[(y * px.w + x) * 4 + k];
      }
    return `rgb(${Math.round(sum[0] / 9)} ${Math.round(sum[1] / 9)} ${Math.round(sum[2] / 9)})`;
  });
}

function Nuclei({ bloch, colors, graticule }: { bloch: BlochVector[]; colors: string[]; graticule?: boolean }) {
  return (
    <>
      {graticule && (
        <g stroke="rgb(255 255 255 / 0.08)" {...STROKE} strokeWidth={1}>
          <path d="M0 50H100" />
          <path d="M25 0V100M50 0V100M75 0V100" strokeDasharray="1.5 3" />
          <path d="M0 25H100M0 75H100" strokeDasharray="1.5 3" />
        </g>
      )}
      {bloch.map((b, i) => {
        const p = nucleusXY(b);
        const r = 2.6 + 2.6 * p.r;
        return (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={r + 2.2} fill={colors[i]} opacity={0.18} />
            <circle cx={p.x} cy={p.y} r={r} fill={colors[i]} stroke="rgb(0 0 0 / 0.55)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
    </>
  );
}

/* ================================================================ layout pieces */

function Caption({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("mt-2.5 flex items-center justify-between gap-3 font-mono text-[10.5px] tabular text-fg-3", className)}>{children}</div>;
}

function Glyph({ kind }: { kind: "plus" | "arrow" }) {
  const Icon = kind === "plus" ? Plus : ArrowRight;
  return <Icon size={12} strokeWidth={1.5} aria-hidden className="justify-self-center text-fg-3" />;
}

/**
 * Input → output strip: frames on row 1 (glyphs centred between them), names on row 2.
 * `glyphs[i]` sits between item i and i + 1.
 */
function Flow({ items, glyphs }: { items: { frame: ReactNode; name: string }[]; glyphs: ("plus" | "arrow")[] }) {
  const cols = items.map((_, i) => (i ? "12px minmax(0,1fr)" : "minmax(0,1fr)")).join(" ");
  return (
    <div className="grid items-center gap-x-1.5 gap-y-2" style={{ gridTemplateColumns: cols }}>
      {items.map((it, i) => (
        <Fragment key={i}>
          {i > 0 && <Glyph kind={glyphs[i - 1] ?? "arrow"} />}
          {it.frame}
        </Fragment>
      ))}
      {items.map((it, i) => (
        <Fragment key={`n${i}`}>
          {i > 0 && <span />}
          <span className="truncate text-[11px] text-fg-2">{it.name}</span>
        </Fragment>
      ))}
    </div>
  );
}

export function Placeholder({ text, active }: { text: string; active?: boolean }) {
  return (
    <Frame className="grid h-[76px] place-items-center">
      {active && <span aria-hidden className="shimmer absolute inset-y-0 w-1/2 bg-linear-to-r from-transparent via-white/[0.05] to-transparent" />}
      <span className="font-mono text-[11px] text-fg-3">{text}</span>
    </Frame>
  );
}

/* ================================================================ per engine */

function GenomeGrid({ bytes }: { bytes: number[] }) {
  const bits = bytes.slice(0, 32).flatMap((b) => Array.from({ length: 8 }, (_, i) => (b >> (7 - i)) & 1));
  return (
    <div role="img" aria-label={`Genome, ${bits.filter(Boolean).length} of 256 bits set`} className="grid grid-cols-32 gap-[2px]">
      {bits.map((bit, i) => (
        <span key={i} className={cx("aspect-[1/1.6] rounded-[1.5px]", bit ? "bg-white/85" : "bg-white/[0.07]")} />
      ))}
    </div>
  );
}

function GenesisPreview({ s }: { s: Specimen }) {
  const g = s.genome!;
  return (
    <div>
      <GenomeGrid bytes={g.bytes} />
      <p className="mt-3 flex flex-wrap gap-x-3 font-mono text-[10.5px] leading-[1.7] text-fg-2">
        {g.hex.match(/.{1,16}/g)?.map((grp, i) => (
          <span key={i}>{grp}</span>
        ))}
      </p>
      <Caption>
        <span>{g.source === "qrng" ? "Toeplitz-extracted QRNG" : "SHA-256 of Born-rule counts"}</span>
        {g.minEntropyPerBit != null && <span>H∞ {g.minEntropyPerBit.toFixed(3)} bit/bit</span>}
      </Caption>
    </div>
  );
}

function ColonyPreview({ s }: { s: Specimen }) {
  const c = s.colony!;
  const seedPx = usePixels(c.seed.url);
  const seed = useSmoothImage(c.seed.url);
  const colors = useMemo(() => cellColors(seedPx, c.bloch), [seedPx, c.bloch]);
  const zz = c.correlations.map((e) => e.zz);
  return (
    <div>
      <Flow
        glyphs={["arrow"]}
        items={[
          { name: "Nuclei", frame: <ProbeFrame raster={null} label="Cell nuclei on the sphere" overlay={<Nuclei bloch={c.bloch} colors={colors} graticule />} /> },
          { name: "Seed", frame: <ProbeFrame raster={seed} label="Colony seed image" overlay={<NucleusMarks bloch={c.bloch} />} /> },
        ]}
      />
      <ol aria-label="Cell nuclei, Bloch vectors" className="mt-4 grid grid-cols-2 gap-x-4 gap-y-[3px] font-mono text-[10.5px] tabular">
        {[0, 1].map((k) => (
          <li key={`h${k}`} aria-hidden className="grid grid-cols-[8px_20px_1fr_1fr_1fr] gap-1 text-fg-3">
            <span />
            <span />
            <span className="text-right">x</span>
            <span className="text-right">y</span>
            <span className="text-right">z</span>
          </li>
        ))}
        {c.bloch.map((b, i) => (
          <li key={i} className="grid grid-cols-[8px_20px_1fr_1fr_1fr] items-center gap-1 text-fg-2">
            <span aria-hidden className="size-2 rounded-full" style={{ background: colors[i] }} />
            <span className="text-fg-3">q{i}</span>
            <span className="text-right">{b.x.toFixed(2)}</span>
            <span className="text-right">{b.y.toFixed(2)}</span>
            <span className="text-right">{b.z.toFixed(2)}</span>
          </li>
        ))}
      </ol>
      <Caption>
        <span>
          {c.numQubits} qubits · {c.correlations.length} links
        </span>
        {zz.length > 0 && (
          <span>
            ⟨ZZ⟩ {formatNumber(Math.min(...zz), 2)}…{formatNumber(Math.max(...zz), 2)}
          </span>
        )}
      </Caption>
    </div>
  );
}

const MACHINE_LABEL: Record<string, string> = { aer: "Ideal simulator", fake_fez: "IBM Fez noise", fake_torino: "IBM Torino noise", fake_marrakesh: "IBM Marrakesh noise" };

function MorphogenesisPreview({ s }: { s: Specimen }) {
  const seedUrl = s.colony?.seed.url;
  const seed = useSmoothImage(seedUrl);
  const skin = useSmoothImage(s.skin!.url);
  const params = s.runs.morphogenesis?.params;
  const machine = typeof params?.machine === "string" ? params.machine : s.controls.machine;
  return (
    <div>
      <Flow
        glyphs={["arrow"]}
        items={[
          ...(seedUrl ? [{ name: "Colony picture", frame: <ProbeFrame raster={seed} label="Colony seed image" /> }] : []),
          { name: "Quantum skin", frame: <ProbeFrame raster={skin} label="Quantum skin" /> },
        ]}
      />
      <Caption>
        <span>
          {s.skin!.width}×{s.skin!.height} · {MACHINE_LABEL[machine] ?? machine}
        </span>
        {typeof params?.shots === "number" && <span>{params.shots} shots</span>}
      </Caption>
    </div>
  );
}

function DecoherencePreview({ s }: { s: Specimen }) {
  const t = s.tissue!;
  const wounds = useMemo(() => s.wounds ?? [], [s.wounds]);
  const skin = useSmoothImage(s.skin?.url);
  const tissue = useSmoothImage(t.url);
  const maskPng = useSmoothImage(s.mask?.url);
  // No stored mask (older specimens): paint it with the pipeline's own renderer — one source of truth.
  const painted = useMemo(() => {
    if (s.mask) return null;
    const m = renderWoundMask(wounds, 64, 64, MASK_BASELINE);
    return smoothRgba({ w: m.width, h: m.height, data: m.data as Px });
  }, [s.mask, wounds]);
  const mask = s.mask ? maskPng : painted;
  const strength = s.runs.decoherence?.params?.strength;
  return (
    <div>
      <Flow
        glyphs={["plus", "arrow"]}
        items={[
          { name: "Skin", frame: <ProbeFrame raster={skin} label="Skin before decoherence" /> },
          { name: "Mask", frame: <ProbeFrame raster={mask} label={`Wound mask, ${wounds.length} wounds`} overlay={<WoundRings wounds={wounds} />} /> },
          { name: "Tissue", frame: <ProbeFrame raster={tissue} label="Aged tissue" /> },
        ]}
      />
      <Caption>
        <span>
          {wounds.length} wound{wounds.length === 1 ? "" : "s"}
        </span>
        {typeof strength === "number" && <span>blur strength {formatNumber(strength, 2)}</span>}
      </Caption>
    </div>
  );
}

function SomaPreview({ s }: { s: Specimen }) {
  const m = s.soma!;
  const sent = useMemo(() => sentGrid(s.runs.soma?.params?.values), [s.runs.soma?.params?.values]);
  const tissuePx = usePixels(sent ? undefined : s.tissue?.url);
  const luma = useMemo(() => {
    if (sent) return cachedRaster(sent.data, "luma", () => smoothField(sent.data, sent.m, sent.n, grayMap(0, 1)));
    if (!tissuePx) return null;
    const g = lumaGrid({ width: tissuePx.w, height: tissuePx.h, data: tissuePx.data }, 32).flat();
    return smoothField(g, 32, 32, grayMap(0, 1));
  }, [sent, tissuePx]);
  const field = useMemo(() => {
    const d = somaDisplacement(m);
    const n = m.size > 0 ? m.size : Math.round(Math.sqrt(m.grid.length));
    return d ? cachedRaster(m.grid, "disp", () => smoothField(d, n, n, divergingMap)) : null;
  }, [m]);
  return (
    <div>
      <Flow
        glyphs={["arrow"]}
        items={[
          { name: "Brightness", frame: <ProbeFrame raster={luma} label="Tissue brightness grid" /> },
          { name: "Shape", frame: <ProbeFrame raster={field} label="Displacement field" antipode /> },
        ]}
      />
      <div className="mt-3 flex items-center gap-2.5 font-mono text-[10.5px] text-fg-3">
        <span>in</span>
        <span aria-hidden className="h-[5px] min-w-0 flex-1 rounded-full" style={{ background: SOMA_LEGEND }} />
        <span>out</span>
        <span className="ml-2 tabular">σ² {formatNumber(m.variance, 4)}</span>
      </div>
    </div>
  );
}

/** LUT heatmap (row 0 = θ 0 at the top, phase wraps) + the texel the blob samples under the probe. */
function LutFrame({ lut, label }: { lut: Lut; label: string }) {
  const raster = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of lut.data)
      if (Number.isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    return cachedRaster(lut.data, "lut", () => smoothField(lut.data, lut.width, lut.height, grayMap(lo, hi, 0.8), true));
  }, [lut]);
  const row = useRef<SVGGElement>(null);
  const ticks = useRef<SVGGElement>(null);

  useEffect(() => {
    const draw = (p: Probe | null) => {
      const on = p?.theta != null;
      if (row.current) row.current.style.display = on ? "" : "none";
      if (ticks.current) ticks.current.style.display = on && p?.phase ? "" : "none";
      if (!on || !p || p.theta == null) return;
      const y = clamp01(p.theta / (Math.PI / 2)) * 100;
      row.current?.querySelectorAll("path").forEach((el) => el.setAttribute("d", `M0 ${f1(y)}H100`));
      if (p.phase && ticks.current)
        ticks.current.querySelectorAll("path").forEach((el, i) => {
          const x = (((p.phase![i % 3] % 1) + 1) % 1) * 100;
          el.setAttribute("d", `M${f1(x)} ${f1(y - 7)}V${f1(y + 7)}`);
        });
    };
    draw(useChrono.getState().probe);
    return useChrono.subscribe((s, prev) => {
      if (s.probe !== prev.probe) draw(s.probe);
    });
  }, []);

  return (
    <Frame className="aspect-square">
      <RasterCanvas raster={raster} label={label} />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden className="pointer-events-none absolute inset-0 size-full">
        <g ref={row} style={{ display: "none" }}>
          <path {...STROKE} stroke="rgb(0 0 0 / 0.45)" strokeWidth={3} />
          <path {...STROKE} stroke="rgb(255 255 255 / 0.75)" strokeWidth={1} />
        </g>
        <g ref={ticks} style={{ display: "none" }}>
          {["rgb(255 120 110)", "rgb(120 230 150)", "rgb(120 170 255)"].map((c) => (
            <path key={c} {...STROKE} stroke={c} strokeWidth={2} />
          ))}
        </g>
      </svg>
    </Frame>
  );
}

function lutRange(l: Lut) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of l.data) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return `${formatNumber(min, 2)}–${formatNumber(max, 2)}`;
}

function MembranePreview({ s }: { s: Specimen }) {
  const m = s.membrane!;
  const luts = [
    { lut: m.rLut, name: "Reflected", label: "Reflectance lookup table" },
    { lut: m.tLut, name: "Transmitted", label: "Transmittance lookup table" },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] gap-x-2 gap-y-1.5">
        <span />
        {luts.map((l) => (
          <span key={l.name} className="text-[11px] text-fg-2">
            {l.name}
          </span>
        ))}
        <div aria-hidden className="flex flex-col items-end justify-between py-0.5 font-mono text-[9.5px] leading-none text-fg-3">
          <span>0°</span>
          <ArrowDown size={10} strokeWidth={1.5} />
          <span>90°</span>
        </div>
        {luts.map((l) => (
          <LutFrame key={l.name} lut={l.lut} label={l.label} />
        ))}
        <span />
        {luts.map((l) => (
          <div key={l.name} className="flex items-center justify-between gap-2 font-mono text-[10px] tabular text-fg-3">
            <span className="flex items-center gap-1">
              phase <ArrowRight size={10} strokeWidth={1.5} aria-hidden />
            </span>
            <span>{lutRange(l.lut)}</span>
          </div>
        ))}
      </div>
      {m.glsl && <GlslBlock code={m.glsl} />}
    </div>
  );
}

function Track({ name, sec, url, dim }: { name: string; sec?: number; url: string; dim?: boolean }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-[11px] text-fg-2">{name}</span>
        {sec != null && <span className="font-mono text-[10.5px] tabular text-fg-3">{sec.toFixed(1)} s</span>}
      </div>
      <Frame className={cx("px-3 py-2", dim && "opacity-60")}>
        <Waveform url={url} className="w-full" />
      </Frame>
    </div>
  );
}

/** Voice: the song. Echo: song → echoed song (what plays on the organism). */
function AudioPreview({ stage, s }: { stage: "voice" | "echo"; s: Specimen }) {
  const a = stage === "voice" ? s.voice! : s.echo!;
  const song = stage === "echo" ? s.voice : undefined;
  return (
    <div className="flex flex-col">
      {song?.url && (
        <>
          <Track name="Song" sec={song.durationSec} url={song.url} dim />
          <ArrowDown size={12} strokeWidth={1.5} aria-hidden className="my-2 self-center text-fg-3" />
        </>
      )}
      <Track name={stage === "echo" ? "Echo" : "Song"} sec={a.durationSec} url={a.url} />
    </div>
  );
}

function GlslBlock({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const lines = code.split("\n").length;
  return (
    <div className="rounded-[10px] shadow-[inset_0_0_0_1px_var(--hairline)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left text-[12px] text-fg-2 transition-colors duration-200 hover:text-fg-1"
      >
        <ChevronRight size={14} strokeWidth={1.5} className={cx("transition-transform duration-200", open && "rotate-90")} aria-hidden />
        GLSL
        <span className="ml-auto font-mono text-[10.5px] text-fg-3">{lines} lines</span>
      </button>
      {open && (
        <pre className="thin-scrollbar max-h-56 overflow-auto border-t border-hairline px-3 py-2.5 font-mono text-[10.5px] leading-[1.55] text-fg-2">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

/* ================================================================ public */

/** Does the specimen already hold this engine's artifact? */
export function hasArtifact(stage: StageId, s: Specimen | null): s is Specimen {
  if (!s) return false;
  switch (stage) {
    case "genesis":
      return !!s.genome;
    case "colony":
      return !!s.colony;
    case "morphogenesis":
      return !!s.skin;
    case "decoherence":
      return !!s.tissue;
    case "soma":
      return !!s.soma;
    case "membrane":
      return !!s.membrane;
    case "voice":
      return !!s.voice?.url;
    case "echo":
      return !!s.echo?.url;
  }
}

/**
 * The artifact(s) of one engine, or a placeholder: `active` = the engine is computing,
 * `waiting` = what to say when there is nothing yet (e.g. "Waiting for Create").
 */
export function ArtifactPreview({ stage, specimen, active, waiting = "Not computed yet" }: { stage: StageId; specimen: Specimen | null; active: boolean; waiting?: string }) {
  if (!hasArtifact(stage, specimen)) return <Placeholder text={active ? "Computing…" : waiting} active={active} />;
  const s = specimen;
  switch (stage) {
    case "genesis":
      return <GenesisPreview s={s} />;
    case "colony":
      return <ColonyPreview s={s} />;
    case "morphogenesis":
      return <MorphogenesisPreview s={s} />;
    case "decoherence":
      return <DecoherencePreview s={s} />;
    case "soma":
      return <SomaPreview s={s} />;
    case "membrane":
      return <MembranePreview s={s} />;
    case "voice":
    case "echo":
      return <AudioPreview stage={stage} s={s} />;
  }
}
