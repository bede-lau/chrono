"use client";
import { Activity, Lightbulb, MoveHorizontal, Music2, RotateCcw, Waves } from "lucide-react";
import { useId, type KeyboardEvent, type PointerEvent } from "react";
import type { SpecimenInteractionMode } from "@/lib/chain/types";
import { unlockAudioContext } from "@/lib/audio/player";
import { useChrono } from "@/lib/store";
import { canEvolve } from "./actions";
import { cx } from "./primitives";
import { InteractionMenu } from "./InteractionMenu";

/** Small, immediate experiments. Only Touch creates a wound for the next evolution. */
export function SpecimenProbes({ compact = false }: { compact?: boolean }) {
  const available = useChrono((s) => canEvolve(s.specimen) && s.mode === "idle");
  const mode = useChrono((s) => s.interactionMode);
  const setInteractionMode = useChrono((s) => s.setInteractionMode);
  const wounds = useChrono((s) => s.pendingWounds.length);
  const inspecting = useChrono((s) => s.probe?.source === "inspect");
  const pulse = useChrono((s) => s.triggerPulse);
  const setProbe = useChrono((s) => s.setProbe);
  const setGesture = useChrono((s) => s.setGesture);
  const activeGesture = useChrono((s) => s.gesture?.active ? s.gesture.kind : null);
  const rhythm = useChrono((s) => s.rhythm);
  const tapRhythm = useChrono((s) => s.tapRhythm);
  const setRhythmBpm = useChrono((s) => s.setRhythmBpm);
  const audioEnabled = useChrono((s) => s.audioEnabled);
  const setAudioEnabled = useChrono((s) => s.setAudioEnabled);
  const lightProbe = useChrono((s) => s.lightProbe);
  const setLightProbe = useChrono((s) => s.setLightProbe);
  const modeId = useId();
  if (!available) return null;
  const expanded = mode === "pressure" || mode === "tug" || mode === "rhythm" || mode === "light";
  const expandedWidth = mode === "pressure" || mode === "tug" ? 280 : mode === "rhythm" ? 304 : 340;
  const showHint = mode !== "inspect" || inspecting;
  // Leave the 344px inspector, its 24px edge inset and a 16px gap clear on narrower desktops.
  const desktopLeft = `min(50%, calc(100% - 344px - 24px - 16px - ${expanded ? expandedWidth / 2 : 130}px))`;
  const changeMode = (next: SpecimenInteractionMode) => { setProbe(null); setGesture(null); setInteractionMode(next); };
  const startDemo = (kind: "pressure" | "tug") => setGesture({ fromControl: true, kind, u: 0.25, v: 0.5, dx: kind === "tug" ? 0.32 : 0.16, dy: kind === "tug" ? -0.14 : 0, heldAt: Date.now(), active: true });
  const stopDemo = () => setGesture(null);
  return (
    <section aria-label="Specimen interactions" data-interaction-controls style={{ left: compact ? undefined : desktopLeft, width: expanded ? expandedWidth : undefined }} className={cx("pointer-events-auto absolute left-1/2 flex w-max max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col items-center rounded-2xl border border-white/[0.08] bg-stage/90 backdrop-blur-sm", expanded ? "gap-2 px-3 py-2.5" : "px-2.5 py-2", compact ? "bottom-[calc(var(--safe-bottom)+174px)]" : "bottom-[calc(var(--rail-clearance)+16px)]")}>
      <div className="flex w-full items-center justify-between gap-1.5">
        <InteractionMenu id={modeId} value={mode} onChange={changeMode} describedBy={showHint ? `${modeId}-hint` : undefined} />
        <button type="button" onClick={pulse} aria-label="Pulse specimen" title="Stimulate the membrane without leaving a wound" className="flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] text-fg-1 transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-white/50"><Activity size={13} strokeWidth={1.5} aria-hidden /> Pulse</button>
      </div>
      {(mode === "pressure" || mode === "tug") && <GestureControl kind={mode} active={activeGesture === mode} onStart={startDemo} onStop={stopDemo} />}
      {mode === "rhythm" && <RhythmControl at={rhythm.at} taps={rhythm.taps} bpm={rhythm.bpm} streak={rhythm.streak} accuracy={rhythm.accuracy} audioEnabled={audioEnabled} onTap={() => tapRhythm()} onBpm={setRhythmBpm} onUnmute={() => { unlockAudioContext(); setAudioEnabled(true); }} />}
      {mode === "light" && <LightControl value={lightProbe} onChange={setLightProbe} />}
      {showHint && <p id={`${modeId}-hint`} className={cx("w-full text-[10px] leading-[1.45]", expanded ? "text-left text-fg-2" : "mt-1 max-w-[320px] text-center text-fg-3")} role="status" aria-live="polite">
        {mode === "touch" && (wounds ? `${wounds} touch${wounds === 1 ? "" : "es"} · Evolve to age` : "Touch to leave a mark · Drag to turn")}
        {mode === "inspect" && "Point pinned · read-only"}
        {mode === "pressure" && (activeGesture === "pressure" ? "Pressing · release to spring back" : "Hold to press; drag outward to stretch, then release to spring back")}
        {mode === "tug" && (activeGesture === "tug" ? "Linked · release to settle" : "Pull a patch to wake its linked partner across the specimen")}
        {mode === "rhythm" && "Tap a beat or press Space; closer timing gives the organism a stronger response"}
        {mode === "light" && "Drag across the specimen, or use the controls, to move the study light"}
      </p>}
    </section>
  );
}

function GestureControl({ kind, active, onStart, onStop }: { kind: "pressure" | "tug"; active: boolean; onStart: (kind: "pressure" | "tug") => void; onStop: () => void }) {
  const Icon = kind === "pressure" ? Waves : MoveHorizontal;
  const pointerDown = (event: PointerEvent<HTMLButtonElement>) => { event.currentTarget.setPointerCapture?.(event.pointerId); onStart(kind); };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => { if (!event.repeat && (event.key === " " || event.key === "Enter")) { event.preventDefault(); onStart(kind); } };
  const keyUp = (event: KeyboardEvent<HTMLButtonElement>) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); onStop(); } };
  return <button type="button" aria-pressed={active} onPointerDown={pointerDown} onPointerUp={onStop} onPointerCancel={onStop} onLostPointerCapture={onStop} onBlur={onStop} onPointerLeave={(event) => { if (event.buttons) onStop(); }} onKeyDown={keyDown} onKeyUp={keyUp} className={cx("flex h-10 w-full items-center justify-center gap-2 rounded-xl border px-3 text-[11px] transition-colors focus-visible:outline focus-visible:outline-white/50", active ? "border-sky-100/30 bg-sky-200/[0.14] text-sky-50" : "border-white/[0.1] bg-white/[0.055] text-fg-1 hover:bg-white/[0.1] active:bg-white/[0.14]")} aria-label={`Hold to demonstrate ${kind === "pressure" ? "pressure" : "an entangled tug"}`}><Icon size={14} strokeWidth={1.5} aria-hidden /> {active ? (kind === "pressure" ? "Pressing" : "Linked") : `Hold to ${kind === "pressure" ? "Press" : "Tug"}`}</button>;
}

function RhythmControl({ at, taps, bpm, streak, accuracy, audioEnabled, onTap, onBpm, onUnmute }: { at: number; taps: number; bpm: number; streak: number; accuracy: number | null; audioEnabled: boolean; onTap: () => void; onBpm: (bpm: number) => void; onUnmute: () => void }) {
  const bpmId = useId();
  const score = taps === 0 ? "First beat" : accuracy === null ? "Find the pulse" : accuracy >= 0.85 ? "In sync" : accuracy >= 0.6 ? "Close" : "Off beat";
  const feedback = streak > 1 ? `${score} · ${streak}x` : score;
  return <div className="w-full">
    <style>{"@keyframes chrono-rhythm-beat { 0%, 18% { transform: scale(1); opacity: .45 } 8% { transform: scale(1.7); opacity: 1 } } @media (prefers-reduced-motion: reduce) { .chrono-rhythm-beat { animation: none !important; } }"}</style>
    <div className="grid grid-cols-2 items-center gap-3">
      <button type="button" onClick={onTap} className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-sky-200/15 bg-sky-200/[0.07] px-3 text-[11px] text-sky-100 transition-colors hover:bg-sky-200/[0.14] active:scale-[0.96] focus-visible:outline focus-visible:outline-white/50" aria-label="Tap beat"><Music2 size={14} strokeWidth={1.5} aria-hidden /> Tap beat</button>
      <div className="flex min-w-0 items-center justify-end gap-2">
        <span className="chrono-rhythm-beat size-1.5 shrink-0 rounded-full bg-sky-100" aria-hidden style={{ animationName: "chrono-rhythm-beat", animationDuration: `${60 / bpm}s`, animationTimingFunction: "cubic-bezier(.2,.9,.35,1)", animationIterationCount: "infinite", animationPlayState: at ? "running" : "paused" }} />
        <output className="truncate text-[10px] text-sky-100/90" aria-live="polite">{feedback}</output>
      </div>
    </div>
    <div className="mt-2 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <label htmlFor={bpmId} className="text-[10px] text-fg-2">Tempo</label>
        {!audioEnabled && <button type="button" onClick={onUnmute} className="text-[10px] text-sky-100/80 underline decoration-sky-100/30 underline-offset-2 hover:text-sky-50">Unmute</button>}
      </div>
      <output htmlFor={bpmId} className="text-right font-mono text-[10px] tabular-nums text-fg-2">{bpm} BPM</output>
    </div>
    <input id={bpmId} className="slider mt-0.5" type="range" min="60" max="140" step="1" value={bpm} aria-valuetext={`${bpm} beats per minute`} style={{ ["--fill" as string]: `${((bpm - 60) / 80) * 100}%` }} onChange={(event) => onBpm(Number(event.target.value))} />
  </div>;
}

function LightControl({ value, onChange }: { value: { x: number; y: number } | null; onChange: (value: { x: number; y: number } | null) => void }) {
  const xId = useId(); const yId = useId(); const x = value?.x ?? -0.32; const y = value?.y ?? 0.36;
  const change = (part: "x" | "y", next: number) => onChange({ x: part === "x" ? next : x, y: part === "y" ? next : y });
  return <div className="mt-1 grid w-full max-w-[270px] grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1"><Lightbulb size={12} className="row-span-2 text-amber-100/80" strokeWidth={1.5} aria-hidden /><label htmlFor={xId} className="sr-only">Light left to right</label><input id={xId} className="slider" type="range" min="-1" max="1" step="0.05" value={x} aria-label="Light left to right" style={{ ["--fill" as string]: `${((x + 1) / 2) * 100}%` }} onChange={(event) => change("x", Number(event.target.value))} /><button type="button" onClick={() => onChange(null)} className="row-span-2 flex size-7 items-center justify-center rounded-full text-fg-3 transition-colors hover:bg-white/[0.1] hover:text-fg-1 focus-visible:outline focus-visible:outline-white/50" aria-label="Reset light position" title="Reset light position"><RotateCcw size={12} strokeWidth={1.5} /></button><label htmlFor={yId} className="sr-only">Light up and down</label><input id={yId} className="slider" type="range" min="-1" max="1" step="0.05" value={y} aria-label="Light up and down" style={{ ["--fill" as string]: `${((y + 1) / 2) * 100}%` }} onChange={(event) => change("y", Number(event.target.value))} /></div>;
}
