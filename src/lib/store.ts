"use client";
/**
 * Chrono — global client state (zustand).
 *
 * OWNER: orchestrator. UI, viewport, audio and pipeline agents all read/write through this.
 * Rule: you may ADD fields/actions; never rename/remove existing ones.
 */
import { create } from "zustand";
import {
  DEFAULT_CONTROLS,
  type Controls,
  type LogLine,
  type Specimen,
  type StageId,
  type StageRun,
  type Wound,
  type ArchiveIndex,
} from "./chain/types";

export type ChainMode = "idle" | "growing" | "evolving";

export interface ChronoState {
  /** Specimen currently on screen (may be partially built while the chain runs). */
  specimen: Specimen | null;
  /** Archive of pre-grown specimens (public/specimens/index.json). */
  archive: ArchiveIndex["specimens"];
  /** Live stage status for the chain rail. */
  runs: Partial<Record<StageId, StageRun>>;
  mode: ChainMode;
  activeStage: StageId | null;
  controls: Controls;
  /** Wounds painted since the last decoherence pass (pending evolve). */
  pendingWounds: Wound[];
  /** Stage open in the inspector drawer. */
  selectedStage: StageId | null;
  audioEnabled: boolean;
  /** 0..1 smoothed audio level — the viewport uses it to make the organism breathe. */
  audioLevel: number;
  fps: number;
  log: LogLine[];

  setSpecimen: (s: Specimen | null) => void;
  patchSpecimen: (p: Partial<Specimen>) => void;
  setArchive: (a: ArchiveIndex["specimens"]) => void;
  setRun: (id: StageId, r: Partial<StageRun>) => void;
  resetRuns: (keep?: StageId[]) => void;
  setMode: (m: ChainMode, active?: StageId | null) => void;
  setControls: (c: Partial<Controls>) => void;
  addWound: (w: Wound) => void;
  clearWounds: () => void;
  selectStage: (id: StageId | null) => void;
  setAudioEnabled: (on: boolean) => void;
  setAudioLevel: (l: number) => void;
  setFps: (fps: number) => void;
  pushLog: (l: Omit<LogLine, "t">) => void;
}

export const useChrono = create<ChronoState>((set) => ({
  specimen: null,
  archive: [],
  runs: {},
  mode: "idle",
  activeStage: null,
  controls: DEFAULT_CONTROLS,
  pendingWounds: [],
  selectedStage: null,
  audioEnabled: false,
  audioLevel: 0,
  fps: 0,
  log: [],

  setSpecimen: (specimen) => set({ specimen, runs: specimen?.runs ?? {} }),
  patchSpecimen: (p) => set((s) => (s.specimen ? { specimen: { ...s.specimen, ...p } } : {})),
  setArchive: (archive) => set({ archive }),
  setRun: (id, r) =>
    set((s) => {
      const prev = s.runs[id] ?? { id, status: "idle" as const, attempt: 0 };
      const next = { ...prev, ...r, id };
      return {
        runs: { ...s.runs, [id]: next },
        specimen: s.specimen ? { ...s.specimen, runs: { ...s.specimen.runs, [id]: next } } : s.specimen,
      };
    }),
  resetRuns: (keep = []) =>
    set((s) => ({
      runs: Object.fromEntries(Object.entries(s.runs).filter(([k]) => keep.includes(k as StageId))),
    })),
  setMode: (mode, activeStage = null) => set({ mode, activeStage }),
  setControls: (c) => set((s) => ({ controls: { ...s.controls, ...c } })),
  addWound: (w) => set((s) => ({ pendingWounds: [...s.pendingWounds, w].slice(-24) })),
  clearWounds: () => set({ pendingWounds: [] }),
  selectStage: (selectedStage) => set({ selectedStage }),
  setAudioEnabled: (audioEnabled) => set({ audioEnabled }),
  setAudioLevel: (audioLevel) => set({ audioLevel }),
  setFps: (fps) => set({ fps }),
  pushLog: (l) => set((s) => ({ log: [...s.log, { ...l, t: Date.now() }].slice(-200) })),
}));
