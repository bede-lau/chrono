"use client";
/**
 * UI-only state (panels, toasts, flash). Chain/specimen state lives in the shared `useChrono` store.
 */
import { create } from "zustand";

export type Panel = "archive" | "info" | "controls" | null;

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
  /** Which UI-initiated chain action is in flight (one at a time). */
  running: Running;
  /** Archive + first specimen resolved (or failed) — gates the empty state. */
  booted: boolean;
  logOpen: boolean;
  toasts: Toast[];
  flashKey: number;
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
  running: null,
  booted: false,
  logOpen: false,
  toasts: [],
  flashKey: 0,
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
