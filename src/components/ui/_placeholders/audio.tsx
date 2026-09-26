"use client";
/**
 * TEMPORARY stand-ins for src/components/audio/* (audio agent): AudioToggle, Spectrum, Waveform, useAudioEngine.
 */
import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { useChrono } from "@/lib/store";

export function useAudioEngine() {
  return { click: (strength: number) => void strength };
}

export function Spectrum() {
  const level = useChrono((s) => s.audioLevel);
  return (
    <span aria-hidden className="flex h-3 items-end gap-[2px]">
      {[0.6, 1, 0.75, 0.45].map((k, i) => (
        <span key={i} className="w-[2px] rounded-full bg-current" style={{ height: `${Math.max(2, 12 * k * Math.max(level, 0.12))}px` }} />
      ))}
    </span>
  );
}

export function AudioToggle() {
  const on = useChrono((s) => s.audioEnabled);
  const set = useChrono((s) => s.setAudioEnabled);
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? "Mute" : "Unmute"}
      onClick={() => set(!on)}
      className="grid size-8 place-items-center rounded-full text-fg-2 transition-colors duration-200 hover:bg-white/6 hover:text-fg-1"
    >
      {on ? <Volume2 size={16} strokeWidth={1.5} /> : <VolumeX size={16} strokeWidth={1.5} />}
    </button>
  );
}

export function Waveform({ url }: { url: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const buf = await (await fetch(url)).arrayBuffer();
        const ctx = new AudioContext();
        const audio = await ctx.decodeAudioData(buf);
        void ctx.close();
        const ch = audio.getChannelData(0);
        const n = 96;
        const step = Math.floor(ch.length / n);
        const p = Array.from({ length: n }, (_, i) => {
          let m = 0;
          for (let j = i * step; j < (i + 1) * step; j++) m = Math.max(m, Math.abs(ch[j]));
          return m;
        });
        if (!dead) setPeaks(p);
      } catch {
        if (!dead) setPeaks([]);
      }
    })();
    return () => {
      dead = true;
    };
  }, [url]);
  useEffect(() => {
    const c = ref.current;
    if (!c || !peaks) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.clientWidth * dpr;
    c.height = c.clientHeight * dpr;
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = "rgba(255,255,255,0.7)";
    const max = Math.max(...peaks, 1e-6);
    const w = c.width / peaks.length;
    peaks.forEach((p, i) => {
      const h = Math.max(1 * dpr, (p / max) * c.height * 0.9);
      g.fillRect(i * w + w * 0.25, (c.height - h) / 2, w * 0.5, h);
    });
  }, [peaks]);
  return <canvas ref={ref} className="h-14 w-full" aria-label="Waveform" />;
}
