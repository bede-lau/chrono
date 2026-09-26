"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronUp } from "lucide-react";
import { STAGES, type LogLine } from "@/lib/chain/types";
import { useChrono } from "@/lib/store";
import { useFrameRate } from "@/hooks/useFrameRate";
import { formatClock, formatLatency } from "./format";
import { T, cx } from "./primitives";
import { useUi } from "./uiStore";

const GLYPH: Record<LogLine["level"], string> = { info: "·", ok: "✓", warn: "!", error: "✕" };

function useEntropyDelta(): { entropy?: number; delta: number | null } {
  const entropy = useChrono((s) => s.specimen?.metrics?.entropy);
  const [delta, setDelta] = useState<number | null>(null);
  useEffect(
    () =>
      useChrono.subscribe((s, prev) => {
        const a = prev.specimen?.metrics?.entropy;
        const b = s.specimen?.metrics?.entropy;
        if (a === b) return;
        setDelta(a != null && b != null && prev.specimen?.id === s.specimen?.id ? b - a : null);
      }),
    [],
  );
  return { entropy, delta };
}

function Log() {
  const log = useChrono((s) => s.log);
  const ref = useRef<HTMLOListElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length]);
  return (
    <motion.div
      id="chrono-log"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={T}
      className="absolute bottom-full left-0 mb-3 w-[min(380px,calc(100vw-40px))] overflow-hidden rounded-[12px] glass-strong shadow-2xl shadow-black/50"
    >
      <ol ref={ref} aria-label="Chain log" className="thin-scrollbar max-h-[240px] overflow-y-auto px-3 py-2.5 font-mono text-[10.5px] leading-[1.7] tabular">
        {log.length === 0 && <li className="text-fg-3">No events yet</li>}
        {log.map((l, i) => {
          const stage = STAGES.find((s) => s.id === l.stage);
          return (
            <li key={`${l.t}-${i}`} className="grid grid-cols-[52px_10px_1fr] gap-1.5">
              <span className="text-fg-4">{formatClock(l.t)}</span>
              <span aria-label={l.level} className={cx(l.level === "error" ? "text-danger" : l.level === "warn" ? "text-fg-1" : l.level === "ok" ? "text-fg-2" : "text-fg-3")}>
                {GLYPH[l.level]}
              </span>
              <span className={cx("min-w-0 break-words", l.level === "error" ? "text-danger" : "text-fg-2")}>
                {stage && <span className="text-fg-3">{stage.title.toLowerCase()} </span>}
                {l.msg}
              </span>
            </li>
          );
        })}
      </ol>
    </motion.div>
  );
}

export function Telemetry() {
  const fps = useFrameRate();
  const activeStage = useChrono((s) => s.activeStage);
  const runs = useChrono((s) => s.runs);
  const qubits = useChrono((s) => s.specimen?.metrics?.qubitsUsed ?? (s.specimen?.colony ? 12 + s.specimen.colony.numQubits : undefined));
  const logCount = useChrono((s) => s.log.length);
  const { entropy, delta } = useEntropyDelta();
  const open = useUi((s) => s.logOpen);
  const setOpen = useUi((s) => s.setLogOpen);

  const engine = STAGES.find((s) => s.id === activeStage)?.engineId;
  const last = Object.values(runs)
    .filter((r) => r?.latencyMs != null && r.finishedAt)
    .sort((a, b) => (b!.finishedAt ?? 0) - (a!.finishedAt ?? 0))[0];

  const rows: [string, React.ReactNode][] = [
    ["fps", fps || "—"],
    ["qubits", qubits ?? "—"],
    ["engine", engine ? <span className="text-fg-1">{engine}</span> : "idle"],
    ["latency", formatLatency(last?.latencyMs)],
    [
      "entropy",
      entropy != null ? (
        <>
          {entropy.toFixed(2)}
          {delta != null && Math.abs(delta) > 0.0005 && (
            <span className="text-fg-3">
              {" "}
              Δ{delta > 0 ? "+" : "−"}
              {Math.abs(delta).toFixed(2)}
            </span>
          )}
        </>
      ) : (
        "—"
      ),
    ],
  ];

  return (
    <div className="pointer-events-auto relative">
      <AnimatePresence>{open && <Log />}</AnimatePresence>
      <dl aria-label="Telemetry" className="grid grid-cols-[auto_auto] gap-x-4 gap-y-[3px] font-mono text-[10.5px] leading-[14px] tabular">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-fg-3">{k}</dt>
            <dd className="text-fg-2">{v}</dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="chrono-log"
        onClick={() => setOpen(!open)}
        className="-ml-1.5 mt-1.5 flex h-6 items-center gap-1 rounded-full px-1.5 font-mono text-[10.5px] text-fg-3 transition-colors duration-200 hover:text-fg-1"
      >
        log
        <span className="tabular text-fg-4">{logCount}</span>
        <ChevronUp size={12} strokeWidth={1.5} className={cx("transition-transform duration-300", !open && "rotate-180")} aria-hidden />
      </button>
    </div>
  );
}
