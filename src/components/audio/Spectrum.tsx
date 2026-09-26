"use client";
/**
 * Spectrum — OWNER: audio agent.
 * Larger canvas spectrum: log-frequency bars, white 60% alpha, DPR-aware.
 */
import { useEffect, useRef } from "react";
import { useChrono } from "@/lib/store";
import { getSpectrum } from "@/lib/audio/player";

const RAW_BINS = 128;
const BARS = 48;

// Precompute log-scale bin edges once (bin 0 kept low-passed so silence at DC isn't a giant bar).
const BIN_EDGES: number[] = (() => {
  const minBin = 1;
  const maxBin = RAW_BINS - 1;
  const edges: number[] = [];
  for (let i = 0; i <= BARS; i++) {
    edges.push(Math.floor(minBin * Math.pow(maxBin / minBin, i / BARS)));
  }
  return edges;
})();

export default function Spectrum({ className }: { className?: string }) {
  const audioEnabled = useChrono((s) => s.audioEnabled);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rawRef = useRef(new Uint8Array(RAW_BINS));

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      const ctx2d = canvas?.getContext("2d");
      if (canvas && ctx2d) {
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth || 1;
        const h = canvas.clientHeight || 1;
        const pw = Math.max(1, Math.round(w * dpr));
        const ph = Math.max(1, Math.round(h * dpr));
        if (canvas.width !== pw || canvas.height !== ph) {
          canvas.width = pw;
          canvas.height = ph;
        }
        ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx2d.clearRect(0, 0, w, h);

        const raw = rawRef.current;
        if (audioEnabled) getSpectrum(raw);
        else raw.fill(0);

        ctx2d.fillStyle = "rgba(255,255,255,0.6)";
        const gap = 1;
        const barW = (w - gap * (BARS - 1)) / BARS;
        for (let i = 0; i < BARS; i++) {
          const b0 = BIN_EDGES[i];
          const b1 = Math.max(b0 + 1, BIN_EDGES[i + 1]);
          let sum = 0;
          let count = 0;
          for (let j = b0; j < b1 && j < RAW_BINS; j++) {
            sum += raw[j];
            count++;
          }
          const v = count ? sum / count / 255 : 0;
          const barH = Math.max(1, v * h);
          ctx2d.fillRect(i * (barW + gap), h - barH, barW, barH);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [audioEnabled]);

  return <canvas ref={canvasRef} className={className ?? "h-24 w-full"} aria-hidden="true" />;
}
