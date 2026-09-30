"use client";
/**
 * Waveform — OWNER: audio agent.
 * Fetches + decodes a WAV (our own isomorphic decodeWav, no AudioContext needed just to draw) and
 * renders a static mirrored waveform with a play/pause button and a live playhead. For the
 * inspector (voice/echo stages).
 */
import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { decodeWav } from "@/lib/audio/wav";

const BUCKETS = 200;

export default function Waveform({ url, className }: { url: string; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const peaksRef = useRef<Float32Array | null>(null);
  const rafRef = useRef(0);
  const [playback, setPlayback] = useState({ url: "", playing: false, progress: 0 });
  const [loadVersion, setLoadVersion] = useState(0);
  const playing = playback.url === url && playback.playing;
  const progress = playback.url === url ? playback.progress : 0;

  const draw = () => {
    const canvas = canvasRef.current;
    const ctx2d = canvas?.getContext("2d");
    if (!canvas || !ctx2d) return;
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

    const peaks = peaksRef.current;
    if (peaks) {
      const mid = h / 2;
      const barW = w / peaks.length;
      ctx2d.fillStyle = "rgba(255,255,255,0.6)";
      for (let i = 0; i < peaks.length; i++) {
        const amp = peaks[i] * mid;
        ctx2d.fillRect(i * barW, mid - amp, Math.max(1, barW - 1), Math.max(1, amp * 2));
      }
    }

    ctx2d.strokeStyle = "rgba(255,255,255,0.9)";
    ctx2d.lineWidth = 1;
    const x = progress * w;
    ctx2d.beginPath();
    ctx2d.moveTo(x, 0);
    ctx2d.lineTo(x, h);
    ctx2d.stroke();
  };

  useEffect(() => {
    let cancelled = false;
    peaksRef.current = null;
    audioRef.current?.pause();
    audioRef.current = null;

    (async () => {
      try {
        const res = await fetch(url);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const { channels } = decodeWav(bytes);
        if (cancelled) return;
        const ch = channels[0] ?? new Float32Array(0);
        const peaks = new Float32Array(BUCKETS);
        const step = Math.max(1, Math.floor(ch.length / BUCKETS));
        for (let i = 0; i < BUCKETS; i++) {
          let max = 0;
          const start = i * step;
          for (let j = start; j < start + step && j < ch.length; j++) {
            const v = Math.abs(ch[j]);
            if (v > max) max = v;
          }
          peaks[i] = max;
        }
        peaksRef.current = peaks;
        setLoadVersion((version) => version + 1);
      } catch {
        // leave the canvas blank on fetch/decode failure
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadVersion, progress, url]);

  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(rafRef.current);
      return;
    }
    const audio = audioRef.current;
    const step = () => {
      if (audio && audio.duration) {
        const nextProgress = audio.currentTime / audio.duration;
        setPlayback((current) => current.url === url ? { ...current, progress: nextProgress } : current);
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, url]);

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      audioRef.current?.pause();
    },
    [],
  );

  const togglePlay = () => {
    if (!audioRef.current) {
      const audio = new Audio(url);
      audio.addEventListener("ended", () => {
        setPlayback({ url, playing: false, progress: 0 });
      });
      audioRef.current = audio;
    }
    const audio = audioRef.current;
    if (playing) {
      audio.pause();
      setPlayback({ url, playing: false, progress: audio.duration ? audio.currentTime / audio.duration : 0 });
    } else {
      void audio.play().catch(() => {});
      setPlayback({ url, playing: true, progress: audio.duration ? audio.currentTime / audio.duration : 0 });
    }
  };

  return (
    <div className={"flex w-full items-center gap-2 " + (className ?? "")}>
      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? "Pause" : "Play"}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.08] text-white/90 transition-colors hover:bg-white/[0.06] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
      >
        {playing ? <Pause size={14} strokeWidth={1.5} /> : <Play size={14} strokeWidth={1.5} />}
      </button>
      <canvas ref={canvasRef} className="h-16 flex-1" />
    </div>
  );
}
