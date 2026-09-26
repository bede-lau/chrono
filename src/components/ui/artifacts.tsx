"use client";
/**
 * Inspector artifact previews — one per stage. Every preview renders the actual artifact the engine produced.
 */
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChevronRight } from "lucide-react";
import type { Specimen, StageId, Lut, Wound } from "@/lib/chain/types";
import { Waveform } from "./deps";
import { blochColor, formatNumber, truncateMiddle } from "./format";
import { cx } from "./primitives";

/* ---------------------------------------------------------------- building blocks */

function Caption({ children }: { children: React.ReactNode }) {
  return <div className="mt-2 flex items-center justify-between gap-3 font-mono text-[10.5px] tabular text-fg-3">{children}</div>;
}

function Frame({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx("relative overflow-hidden rounded-[10px] bg-white/[0.035] shadow-[inset_0_0_0_1px_var(--hairline)]", className)}>{children}</div>;
}

export function PixelImage({ url, alt, width, height, className }: { url: string; alt: string; width: number; height: number; className?: string }) {
  return (
    <Frame className={className}>
      <Image src={url} alt={alt} width={width} height={height} unoptimized className="pixelated block aspect-square h-auto w-full object-cover" />
    </Frame>
  );
}

/** Grayscale heatmap of a row-major float grid, normalised to its own range. */
export function Heatmap({ data, width, height, label, className }: { data: number[]; width: number; height: number; label: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !data.length) return;
    c.width = width;
    c.height = height;
    const g = c.getContext("2d");
    if (!g) return;
    let min = Infinity;
    let max = -Infinity;
    for (const v of data) {
      if (Number.isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    const span = max - min || 1;
    const img = g.createImageData(width, height);
    for (let i = 0; i < width * height; i++) {
      const t = Math.pow(Math.max(0, Math.min(1, ((data[i] ?? min) - min) / span)), 0.8);
      const l = 10 + t * 235;
      img.data[i * 4] = l;
      img.data[i * 4 + 1] = l;
      img.data[i * 4 + 2] = l;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, [data, width, height]);
  return (
    <Frame className={className}>
      <canvas ref={ref} role="img" aria-label={label} className="pixelated block aspect-square h-auto w-full" />
    </Frame>
  );
}

/** Wound mask as sent to blur-v1: baseline everywhere, soft radial wounds, u wraps. */
function MaskPreview({ wounds, baseline = 0.35 }: { wounds: Wound[]; baseline?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const n = 64;
    c.width = n;
    c.height = n;
    const g = c.getContext("2d");
    if (!g) return;
    const img = g.createImageData(n, n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        let v = baseline;
        for (const w of wounds) {
          const du = Math.min(Math.abs(x / n - w.u), 1 - Math.abs(x / n - w.u));
          const dv = y / n - w.v;
          v = Math.max(v, Math.exp(-(du * du + dv * dv) / 0.004) * Math.max(0.2, w.strength));
        }
        const l = v * 255;
        const i = (y * n + x) * 4;
        img.data[i] = l;
        img.data[i + 1] = l;
        img.data[i + 2] = l;
        img.data[i + 3] = 255;
      }
    g.putImageData(img, 0, 0);
  }, [wounds, baseline]);
  return (
    <Frame>
      <canvas ref={ref} role="img" aria-label={`Wound mask, ${wounds.length} wounds`} className="block aspect-square h-auto w-full" />
    </Frame>
  );
}

function GenomeGrid({ bytes }: { bytes: number[] }) {
  const bits = bytes.slice(0, 32).flatMap((b) => Array.from({ length: 8 }, (_, i) => (b >> (7 - i)) & 1));
  return (
    <div role="img" aria-label={`Genome bit grid, ${bits.filter(Boolean).length} of 256 bits set`} className="grid grid-cols-16 gap-[3px]">
      {bits.map((bit, i) => (
        <span key={i} className={cx("aspect-square rounded-[2px]", bit ? "bg-white/85" : "bg-white/[0.07]")} />
      ))}
    </div>
  );
}

function Pending({ active }: { active: boolean }) {
  return (
    <Frame className="grid aspect-[16/9] place-items-center">
      {active && <span aria-hidden className="shimmer absolute inset-y-0 w-1/2 bg-linear-to-r from-transparent via-white/[0.05] to-transparent" />}
      <span className="font-mono text-[11px] text-fg-3">{active ? "Computing…" : "Not computed yet"}</span>
    </Frame>
  );
}

function Pair({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2.5">{children}</div>;
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

/* ---------------------------------------------------------------- per stage */

export function ArtifactPreview({ stage, specimen, active }: { stage: StageId; specimen: Specimen | null; active: boolean }) {
  const s = specimen;
  switch (stage) {
    case "genesis": {
      const g = s?.genome;
      if (!g) return <Pending active={active} />;
      return (
        <div>
          <GenomeGrid bytes={g.bytes} />
          <p className="mt-3 font-mono text-[10.5px] leading-[1.6] break-all text-fg-2">{g.hex.match(/.{1,16}/g)?.join(" ")}</p>
          <Caption>
            <span>{g.source === "qrng" ? "QRNG extractor" : "SHA-256 of counts"}</span>
            {g.minEntropyPerBit != null && <span>H∞ {g.minEntropyPerBit.toFixed(3)} bit/bit</span>}
          </Caption>
        </div>
      );
    }
    case "colony": {
      const c = s?.colony;
      if (!c) return <Pending active={active} />;
      return (
        <div className="grid grid-cols-[120px_1fr] gap-4">
          <div>
            <PixelImage url={c.seed.url} alt="Colony seed image" width={c.seed.width} height={c.seed.height} />
            <Caption>
              <span>
                {c.seed.width}×{c.seed.height}
              </span>
            </Caption>
          </div>
          <ol aria-label="Cell nuclei, Bloch vectors" className="flex flex-col gap-[3px] font-mono text-[10.5px] tabular">
            <li aria-hidden className="mb-0.5 grid grid-cols-[10px_18px_1fr_1fr_1fr] gap-1.5 text-fg-3">
              <span />
              <span />
              <span className="text-right">x</span>
              <span className="text-right">y</span>
              <span className="text-right">z</span>
            </li>
            {c.bloch.slice(0, 10).map((b, i) => (
              <li key={i} className="grid grid-cols-[10px_18px_1fr_1fr_1fr] items-center gap-1.5 text-fg-2">
                <span aria-hidden className="size-2 rounded-full" style={{ background: blochColor(b) }} />
                <span className="text-fg-3">q{i}</span>
                <span className="text-right">{b.x.toFixed(2)}</span>
                <span className="text-right">{b.y.toFixed(2)}</span>
                <span className="text-right">{b.z.toFixed(2)}</span>
              </li>
            ))}
          </ol>
        </div>
      );
    }
    case "morphogenesis": {
      const k = s?.skin;
      if (!k) return <Pending active={active} />;
      return (
        <div>
          <PixelImage url={k.url} alt="Quantum skin" width={k.width} height={k.height} />
          <Caption>
            <span>
              {k.width}×{k.height} · colour-sphere
            </span>
            {k.assetId && <span>{truncateMiddle(k.assetId, 6, 4)}</span>}
          </Caption>
        </div>
      );
    }
    case "decoherence": {
      const t = s?.tissue;
      if (!t) return <Pending active={active} />;
      const wounds = s?.wounds ?? [];
      return (
        <Pair>
          <div>
            <PixelImage url={t.url} alt="Aged tissue" width={t.width} height={t.height} />
            <Caption>
              <span>Tissue</span>
            </Caption>
          </div>
          <div>
            {s?.mask ? <PixelImage url={s.mask.url} alt="Wound mask" width={s.mask.width} height={s.mask.height} /> : <MaskPreview wounds={wounds} />}
            <Caption>
              <span>Mask</span>
              <span>
                {wounds.length} wound{wounds.length === 1 ? "" : "s"}
              </span>
            </Caption>
          </div>
        </Pair>
      );
    }
    case "soma": {
      const m = s?.soma;
      if (!m) return <Pending active={active} />;
      return (
        <div>
          <Heatmap data={m.grid} width={m.size} height={m.size} label="Displacement field heatmap" />
          <Caption>
            <span>
              {m.size}×{m.size} displacement
            </span>
            <span>σ² {formatNumber(m.variance, 4)}</span>
          </Caption>
        </div>
      );
    }
    case "membrane": {
      const m = s?.membrane;
      if (!m) return <Pending active={active} />;
      return (
        <div className="flex flex-col gap-3">
          <Pair>
            <div>
              <Heatmap data={m.rLut.data} width={m.rLut.width} height={m.rLut.height} label="Reflectance LUT" />
              <Caption>
                <span>R</span>
                <span>{lutRange(m.rLut)}</span>
              </Caption>
            </div>
            <div>
              <Heatmap data={m.tLut.data} width={m.tLut.width} height={m.tLut.height} label="Transmittance LUT" />
              <Caption>
                <span>T</span>
                <span>{lutRange(m.tLut)}</span>
              </Caption>
            </div>
          </Pair>
          {m.glsl && <GlslBlock code={m.glsl} />}
        </div>
      );
    }
    case "voice":
    case "echo": {
      const a = stage === "voice" ? s?.voice : s?.echo;
      if (!a?.url) return <Pending active={active} />;
      return (
        <div>
          <Frame className="px-3 py-2.5">
            <Waveform url={a.url} className="h-14 w-full" />
          </Frame>
          <Caption>
            <span>{stage === "echo" ? "Plays on the organism" : "Reservoir song"}</span>
            {a.durationSec != null && <span>{a.durationSec.toFixed(1)} s</span>}
          </Caption>
        </div>
      );
    }
  }
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
