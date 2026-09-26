"use client";
/**
 * AudioToggle — OWNER: audio agent.
 * Compact pill: speaker icon + 12-bar live mini spectrum. Toggles store.audioEnabled.
 * Monochrome, hairline, 32px tall, aria-pressed, keyboard accessible.
 */
import { useEffect, useRef } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { useChrono } from "@/lib/store";
import { getSpectrum, unlockAudioContext } from "@/lib/audio/player";

const BARS = 12;

export default function AudioToggle({ className }: { className?: string }) {
  const audioEnabled = useChrono((s) => s.audioEnabled);
  const setAudioEnabled = useChrono((s) => s.setAudioEnabled);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef(new Uint8Array(BARS));

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      const ctx2d = canvas?.getContext("2d");
      if (canvas && ctx2d) {
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth || 40;
        const h = canvas.clientHeight || 16;
        const pw = Math.max(1, Math.round(w * dpr));
        const ph = Math.max(1, Math.round(h * dpr));
        if (canvas.width !== pw || canvas.height !== ph) {
          canvas.width = pw;
          canvas.height = ph;
        }
        ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx2d.clearRect(0, 0, w, h);

        const data = dataRef.current;
        if (audioEnabled) getSpectrum(data);
        else data.fill(0);

        const gap = 1.5;
        const barW = (w - gap * (BARS - 1)) / BARS;
        ctx2d.fillStyle = "rgba(255,255,255,0.6)";
        for (let i = 0; i < BARS; i++) {
          const v = audioEnabled ? data[i] / 255 : 0;
          const barH = Math.max(1, v * h);
          ctx2d.fillRect(i * (barW + gap), h - barH, barW, barH);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [audioEnabled]);

  return (
    <button
      type="button"
      aria-pressed={audioEnabled}
      aria-label={audioEnabled ? "Mute audio" : "Unmute audio"}
      onClick={() => {
        unlockAudioContext();
        setAudioEnabled(!audioEnabled);
      }}
      className={
        "inline-flex h-8 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.02] px-3 " +
        "text-white/90 transition-colors hover:bg-white/[0.06] focus:outline-none " +
        "focus-visible:ring-1 focus-visible:ring-white/40 " +
        (className ?? "")
      }
    >
      {audioEnabled ? <Volume2 size={14} strokeWidth={1.5} /> : <VolumeX size={14} strokeWidth={1.5} />}
      <canvas ref={canvasRef} className="h-4 w-10" aria-hidden="true" />
    </button>
  );
}
