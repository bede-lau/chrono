import type { BlochVector, StageRun, StageStatus } from "@/lib/chain/types";

export const pad2 = (n: number) => String(n).padStart(2, "0");

export function formatLatency(ms?: number): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 9.95) return `${s.toFixed(1)} s`;
  const whole = Math.round(s);
  if (whole < 60) return `${whole} s`;
  return `${Math.floor(whole / 60)}m ${pad2(whole % 60)}s`;
}

/** Live counter: whole seconds, then minutes. */
export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}m ${pad2(s % 60)}s`;
}

export function formatClock(t: number): string {
  const d = new Date(t);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatNumber(n: number, digits = 3): string {
  if (Number.isInteger(n)) return String(n);
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 0.001 || abs >= 1e5)) return n.toExponential(2);
  return String(Number(n.toFixed(digits)));
}

/** Compact, human value for the params table. Large arrays collapse to their shape. */
export function formatParam(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return formatNumber(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return v.length > 48 ? `${v.slice(0, 46)}…` : v;
  if (Array.isArray(v)) {
    if (v.length > 0 && Array.isArray(v[0])) return `${v.length}×${(v[0] as unknown[]).length} grid`;
    if (v.length <= 6 && v.every((x) => typeof x !== "object")) return `[${v.map((x) => formatParam(x)).join(", ")}]`;
    return `${v.length} items`;
  }
  try {
    const s = JSON.stringify(v);
    return s.length > 48 ? `${s.slice(0, 46)}…` : s;
  } catch {
    return "…";
  }
}

export function truncateMiddle(s: string, head = 8, tail = 6): string {
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/** Hue (deg) of a Bloch vector's azimuth — the same colour-sphere convention the colony seed uses. */
export function blochHue(b: BlochVector): number {
  const deg = (Math.atan2(b.y, b.x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** CSS colour for a nucleus: hue = azimuth, lightness from z (north pole white, south pole dark). */
export function blochColor(b: BlochVector): string {
  const r = Math.min(1, Math.hypot(b.x, b.y, b.z));
  const sat = Math.round(20 + 70 * Math.min(1, Math.hypot(b.x, b.y) / Math.max(r, 1e-6)) * r);
  const light = Math.round(50 + 30 * b.z);
  return `hsl(${blochHue(b).toFixed(0)} ${sat}% ${light}%)`;
}

export const ACTIVE_STATUSES: readonly StageStatus[] = ["queued", "uploading", "running", "retrying"];
export const isActive = (s?: StageStatus) => !!s && ACTIVE_STATUSES.includes(s);
export const isComplete = (s?: StageStatus) => s === "done" || s === "cached";

export const MAX_ATTEMPTS = 6;

export function statusText(run?: StageRun): string {
  const s = run?.status ?? "idle";
  switch (s) {
    case "idle":
      return "Idle";
    case "queued":
      return "Queued";
    case "uploading":
      return "Uploading";
    case "running":
      return "Running";
    case "retrying":
      return `Retrying ${run?.attempt ?? 1}/${MAX_ATTEMPTS}`;
    case "done":
      return run?.latencyMs != null ? formatLatency(run.latencyMs) : "Done";
    case "cached":
      return "Cached";
    case "failed":
      return "Failed";
  }
}
