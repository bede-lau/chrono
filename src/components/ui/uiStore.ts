"use client";
/**
 * UI-only state (panels, right-panel view, follow mode, toasts, flash).
 * Chain/specimen state lives in the shared `useChrono` store.
 */
import { create } from "zustand";
import type { StageId } from "@/lib/chain/types";

/** Surfaces that open on request. "sheet" = the right panel as a bottom sheet (mobile only). */
export type Panel = "archive" | "info" | "sheet" | null;

/** The right panel's two views. */
export type Tab = "parameters" | "evolution";

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  title: string;
  detail?: string;
  action?: { label: string; run: () => void };
  /** ms; 0 = sticky */
  duration: number;
}

export type Running = "grow" | "evolve" | "load" | null;

interface UiState {
  panel: Panel;
  /**
   * Right panel view. The stage shown in Evolution is `useChrono.selectedStage` (null while on Parameters);
   * `lastStage` remembers it so the Evolution toggle returns to the engine you were reading.
   */
  tab: Tab;
  lastStage: StageId | null;
  /**
   * Follow mode: while a run is in flight and the user has not picked a stage/tab since it started, the Evolution
   * view tracks the running stage. Any manual choice clears it; every new run sets it again.
   */
  follow: boolean;
  /** Compact layout (bottom sheet instead of the fixed right panel). Mirrors `useIsMobile()`. */
  mobile: boolean;
  /** Which UI-initiated chain action is in flight (one at a time). */
  running: Running;
  /** Archive list resolved (or failed). */
  booted: boolean;
  logOpen: boolean;
  toasts: Toast[];
  flashKey: number;
  setTab: (t: Tab) => void;
  setLastStage: (id: StageId | null) => void;
  setFollow: (f: boolean) => void;
  setMobile: (m: boolean) => void;
  setRunning: (r: Running) => void;
  setBooted: (b: boolean) => void;
  openPanel: (p: Panel) => void;
  togglePanel: (p: Exclude<Panel, null>) => void;
  setLogOpen: (open: boolean) => void;
  toast: (t: Omit<Toast, "id" | "duration"> & { duration?: number }) => number;
  dismissToast: (id: number) => void;
  flash: () => void;
}

let toastSeq = 0;

export const useUi = create<UiState>((set) => ({
  panel: null,
  tab: "parameters",
  lastStage: null,
  follow: false,
  mobile: false,
  running: null,
  booted: false,
  logOpen: false,
  toasts: [],
  flashKey: 0,
  setTab: (tab) => set({ tab }),
  setLastStage: (lastStage) => set({ lastStage }),
  setFollow: (follow) => set({ follow }),
  setMobile: (mobile) => set({ mobile }),
  setRunning: (running) => set({ running }),
  setBooted: (booted) => set({ booted }),
  openPanel: (panel) => set({ panel }),
  togglePanel: (p) => set((s) => ({ panel: s.panel === p ? null : p })),
  setLogOpen: (logOpen) => set({ logOpen }),
  toast: (t) => {
    const id = ++toastSeq;
    const duration = t.duration ?? (t.kind === "error" ? 0 : 3200);
    // Keep the stack short: at most 3, newest last; an identical title replaces the old one.
    set((s) => ({ toasts: [...s.toasts.filter((x) => x.title !== t.title), { ...t, id, duration }].slice(-3) }));
    return id;
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  flash: () => set((s) => ({ flashKey: s.flashKey + 1 })),
}));

/** The Evolution view is on screen (desktop panel not covered by the archive, or the mobile sheet open). */
export const selectEvolutionVisible = (s: UiState) => s.tab === "evolution" && (s.mobile ? s.panel === "sheet" : s.panel !== "archive");
