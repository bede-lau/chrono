"use client";
/**
 * /lab/audio — OWNER: audio agent. Sandbox to exercise the audio module in isolation:
 * generates a demo vocabulary in-browser from synthesizeVocabulary (fake membrane/soma/genome),
 * concatenates it into one WAV, plays it via a blob URL through the real store + useAudioEngine,
 * and exercises AudioToggle, Spectrum and Waveform.
 */
import { useEffect, useState } from "react";
import { useChrono } from "@/lib/store";
import { useAudioEngine } from "@/components/audio/useAudioEngine";
import AudioToggle from "@/components/audio/AudioToggle";
import Spectrum from "@/components/audio/Spectrum";
import Waveform from "@/components/audio/Waveform";
import { synthesizeVocabulary } from "@/lib/audio/synth";
import { decodeWav, encodeWav } from "@/lib/audio/wav";
import type { GenomeArtifact, MembraneArtifact, SomaArtifact } from "@/lib/chain/types";

function makeFakeGenome(): GenomeArtifact {
  const bytes = Array.from({ length: 32 }, (_, i) => (i * 37 + 11) % 256);
  return { hex: bytes.map((b) => b.toString(16).padStart(2, "0")).join(""), bytes, source: "qrng" };
}

function makeFakeLut(width: number, height: number, seedOffset: number): number[] {
  const data = new Array<number>(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const theta = (r / Math.max(1, height - 1)) * (Math.PI / 2);
      const phase = (c / width) * Math.PI * 2;
      const v =
        0.3 +
        0.25 * Math.sin(phase * 3 + seedOffset) +
        0.2 * Math.sin(phase * 7 - theta * 2) +
        0.15 * Math.sin(phase * 11 + seedOffset * 1.3);
      data[r * width + c] = Math.max(0, v);
    }
  }
  return data;
}

function makeFakeMembrane(): MembraneArtifact {
  const width = 32;
  const height = 32;
  return {
    params: { reflectance: 0.4, absorption: 0.35, layers: 2, incoming_rays: 6, interaction: 0.6, style: "peaked", resolution: width },
    rLut: { width, height, data: makeFakeLut(width, height, 0) },
    tLut: { width, height, data: makeFakeLut(width, height, 1.7) },
  };
}

function makeFakeSoma(): SomaArtifact {
  const size = 32;
  const grid = new Array<number>(size * size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const v = 0.5 + 0.5 * Math.sin(r * 0.7) * Math.cos(c * 0.5);
      grid[r * size + c] = Math.max(0, Math.min(1, v));
    }
  }
  const mean = grid.reduce((a, b) => a + b, 0) / grid.length;
  const variance = grid.reduce((a, b) => a + (b - mean) * (b - mean), 0) / grid.length;
  return { size, grid, variance };
}

export default function AudioLabPage() {
  const [demoUrl, setDemoUrl] = useState<string | null>(null);
  const [info, setInfo] = useState("generating vocabulary…");
  const setSpecimen = useChrono((s) => s.setSpecimen);
  const audioLevel = useChrono((s) => s.audioLevel);
  const audioEnabled = useChrono((s) => s.audioEnabled);
  const { click } = useAudioEngine();

  useEffect(() => {
    const genome = makeFakeGenome();
    const membrane = makeFakeMembrane();
    const soma = makeFakeSoma();
    const chunks = synthesizeVocabulary(membrane, soma, genome, { chunks: 10, chunkSeconds: 1, sampleRate: 22050 });

    let total = 0;
    const decoded = chunks.map((c) => {
      const d = decodeWav(c.wav);
      total += d.channels[0].length;
      return d.channels[0];
    });
    const merged = new Float32Array(total);
    let off = 0;
    let peak = 0;
    let sumSq = 0;
    let nanFound = false;
    for (const arr of decoded) {
      merged.set(arr, off);
      off += arr.length;
      for (const v of arr) {
        if (Number.isNaN(v)) nanFound = true;
        peak = Math.max(peak, Math.abs(v));
        sumSq += v * v;
      }
    }
    const rms = Math.sqrt(sumSq / Math.max(1, merged.length));
    setInfo(`${chunks.length} chunks · ${total} samples · peak ${peak.toFixed(3)} · rms ${rms.toFixed(3)} · nan:${nanFound}`);

    const wavBytes = encodeWav([merged], 22050);
    const arrayBuffer = new ArrayBuffer(wavBytes.byteLength);
    new Uint8Array(arrayBuffer).set(wavBytes);
    const blob = new Blob([arrayBuffer], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    setDemoUrl(url);

    setSpecimen({
      id: "labfake",
      name: "Lab Specimen",
      createdAt: new Date().toISOString(),
      generation: 0,
      controls: { circuitDepth: 8, entanglement: 0.45, decay: 0.5, machine: "aer" },
      wounds: [],
      echo: { url },
      runs: {},
    });

    return () => URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen flex-col gap-6 bg-[#050506] p-8 font-mono text-white/90">
      <h1 className="text-xs uppercase tracking-[0.14em] text-white/60">Audio Lab</h1>

      <div className="flex flex-wrap items-center gap-4">
        <AudioToggle />
        <span className="text-[11px] text-white/40">{info}</span>
        <span className="text-[11px] text-white/40">enabled: {String(audioEnabled)}</span>
        <span className="text-[11px] text-white/40">level: {audioLevel.toFixed(3)}</span>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[10px] uppercase tracking-[0.14em] text-white/40">Spectrum</span>
        <Spectrum className="h-24 w-full max-w-2xl border border-white/[0.08]" />
      </div>

      {demoUrl && (
        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-[0.14em] text-white/40">Waveform</span>
          <Waveform url={demoUrl} className="max-w-2xl" />
        </div>
      )}

      <button
        type="button"
        onClick={() => click(1)}
        className="h-8 w-fit rounded-full border border-white/[0.08] px-3 text-[10px] uppercase tracking-[0.14em] text-white/90 transition-colors hover:bg-white/[0.06]"
      >
        Wound click
      </button>
    </div>
  );
}
