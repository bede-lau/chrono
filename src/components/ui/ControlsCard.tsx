"use client";
import { useId, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Plus, Square } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { STAGES, type Controls } from "@/lib/chain/types";
import { useChrono } from "@/lib/store";
import { evolve, newSpecimen, stop } from "./actions";
import { MAX_ATTEMPTS, isActive, isComplete } from "./format";
import { ICON, Spinner, T, T_FAST, cx } from "./primitives";
import { useUi } from "./uiStore";

/* ---------------------------------------------------------------- slider */

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-[12px] text-fg-2">
          {label}
        </label>
        <output htmlFor={id} className="font-mono text-[12px] tabular text-fg-1">
          {format(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={format(value)}
        style={{ ["--fill" as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- segmented */

const MACHINES: { value: Controls["machine"]; label: string }[] = [
  { value: "aer", label: "Ideal" },
  { value: "fake_fez", label: "IBM Fez noise" },
];

function Segmented({ value, onChange, layoutId }: { value: Controls["machine"]; onChange: (v: Controls["machine"]) => void; layoutId: string }) {
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const next = MACHINES[(i + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) + MACHINES.length) % MACHINES.length];
    onChange(next.value);
    (e.currentTarget.parentElement?.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Noise model" className="relative grid grid-cols-2 rounded-[10px] bg-white/[0.045] p-[3px]">
      {MACHINES.map((m, i) => {
        const on = value === m.value;
        return (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={on}
            data-value={m.value}
            tabIndex={on || (!MACHINES.some((x) => x.value === value) && i === 0) ? 0 : -1}
            onClick={() => onChange(m.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cx(
              "relative h-7 rounded-[8px] text-[12px] transition-colors duration-200",
              on ? "text-fg-1" : "text-fg-3 hover:text-fg-2",
            )}
          >
            {on && (
              <motion.span
                layoutId={layoutId}
                transition={T}
                className="absolute inset-0 rounded-[8px] bg-white/[0.11] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]"
              />
            )}
            <span className="relative">{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- run progress */

export function useRunProgress() {
  const { runs, mode, activeStage, pendingWounds, hasSpecimen } = useChrono(
    useShallow((s) => ({ runs: s.runs, mode: s.mode, activeStage: s.activeStage, pendingWounds: s.pendingWounds.length, hasSpecimen: !!s.specimen })),
  );
  const running = useUi((s) => s.running);
  const busy = running !== null || mode !== "idle";
  const evolving = mode === "evolving" || running === "evolve";
  const scope = evolving ? STAGES.slice(3) : STAGES;
  const done = scope.filter((s) => isComplete(runs[s.id]?.status)).length;
  const current = STAGES.find((s) => s.id === activeStage) ?? STAGES.find((s) => isActive(runs[s.id]?.status));
  const currentRun = current ? runs[current.id] : undefined;
  return {
    busy,
    loading: running === "load",
    evolving,
    done,
    total: scope.length,
    current,
    retry: currentRun?.status === "retrying" ? `${currentRun.attempt}/${MAX_ATTEMPTS}` : null,
    wounds: pendingWounds,
    hasSpecimen,
  };
}

/** Evolve + New specimen; while the chain runs: live progress + Stop. */
export function ChainActions({ layout = "stack" }: { layout?: "stack" | "row" }) {
  const p = useRunProgress();
  const running = p.busy && !p.loading;
  const pct = p.total ? (p.done / p.total) * 100 : 0;

  return (
    <div className={cx("flex gap-2", layout === "stack" ? "flex-col" : "flex-row items-stretch")}>
      <AnimatePresence mode="popLayout" initial={false}>
        {running ? (
          <motion.div
            key="progress"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={T_FAST}
            role="status"
            aria-label={`${p.evolving ? "Evolving" : "Growing"}: ${p.current?.title ?? "starting"}, ${p.done} of ${p.total} stages`}
            className={cx("relative flex h-10 min-w-0 items-center gap-2.5 overflow-hidden rounded-[11px] bg-white/[0.07] px-3.5 text-[13px] text-fg-1 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]", layout === "row" ? "flex-1" : "w-full")}
          >
            <Spinner size={14} className="shrink-0 text-accent" />
            <span className="min-w-0 truncate">
              {p.current?.title ?? (p.evolving ? "Evolving" : "Growing")}
              {p.retry && <span className="text-fg-3"> · retry {p.retry}</span>}
            </span>
            <span className="ml-auto font-mono text-[11.5px] tabular text-fg-3">
              {p.done}/{p.total}
            </span>
            <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] bg-white/[0.06]">
              <motion.span className="block h-full bg-fg-1" initial={false} animate={{ width: `${pct}%` }} transition={T} />
            </span>
          </motion.div>
        ) : (
          <motion.button
            key="evolve"
            type="button"
            data-accent-focus
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={T_FAST}
            disabled={!p.hasSpecimen || p.busy}
            onClick={evolve}
            aria-keyshortcuts="Space"
            aria-label={p.wounds > 0 ? `Evolve, ${p.wounds} pending wound${p.wounds === 1 ? "" : "s"}` : "Evolve"}
            className={cx("group relative flex h-10 min-w-0 items-center justify-center gap-2 rounded-[11px] bg-[#f4f4f5] text-[13px] font-medium text-black transition-[background-color,opacity,transform] duration-200 ease-out hover:bg-white active:scale-[0.985] disabled:bg-white/10 disabled:text-fg-3", layout === "row" ? "flex-1" : "w-full")}
          >
            Evolve
            <AnimatePresence initial={false}>
              {p.wounds > 0 && (
                <motion.span
                  key="badge"
                  initial={{ opacity: 0, scale: 0.6, width: 0 }}
                  animate={{ opacity: 1, scale: 1, width: "auto" }}
                  exit={{ opacity: 0, scale: 0.6, width: 0 }}
                  transition={T_FAST}
                  className="grid h-5 min-w-5 place-items-center rounded-full bg-black px-1.5 font-mono text-[10.5px] tabular text-white"
                  aria-hidden
                >
                  <motion.span key={p.wounds} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={T_FAST}>
                    {p.wounds}
                  </motion.span>
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        )}
      </AnimatePresence>

      {running ? (
        <button
          type="button"
          onClick={stop}
          aria-label="Stop"
          className={cx(
            "flex items-center justify-center gap-1.5 rounded-[11px] text-[12.5px] text-fg-2 shadow-[inset_0_0_0_1px_var(--hairline-strong)] transition-colors duration-200 hover:bg-white/5 hover:text-fg-1",
            layout === "stack" ? "h-9 w-full" : "h-10 w-10 shrink-0",
          )}
        >
          <Square size={12} strokeWidth={1.75} />
          {layout === "stack" && "Stop"}
        </button>
      ) : (
        layout === "stack" && (
          <button
            type="button"
            onClick={newSpecimen}
            disabled={p.busy}
            aria-keyshortcuts="N"
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-[11px] text-[12.5px] text-fg-2 shadow-[inset_0_0_0_1px_var(--hairline-strong)] transition-colors duration-200 hover:bg-white/5 hover:text-fg-1 disabled:opacity-40"
          >
            <Plus {...ICON} size={14} />
            New specimen
          </button>
        )
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- body */

export function ControlsBody({ layoutId = "machine" }: { layoutId?: string }) {
  const controls = useChrono((s) => s.controls);
  const setControls = useChrono((s) => s.setControls);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <Slider label="Circuit depth" value={controls.circuitDepth} min={1} max={12} step={1} format={(v) => String(v)} onChange={(v) => setControls({ circuitDepth: v })} />
        <Slider label="Entanglement" value={controls.entanglement} min={0} max={1} step={0.01} format={(v) => v.toFixed(2)} onChange={(v) => setControls({ entanglement: v })} />
        <Slider label="Decoherence" value={controls.decay} min={0} max={1} step={0.01} format={(v) => v.toFixed(2)} onChange={(v) => setControls({ decay: v })} />
      </div>
      <Segmented value={controls.machine} onChange={(machine) => setControls({ machine })} layoutId={layoutId} />
      <ChainActions />
    </div>
  );
}

/** Desktop: compact floating card on the right edge. */
export function ControlsCard() {
  return (
    <motion.section
      aria-label="Mutation controls"
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ ...T, delay: 0.15 }}
      className="pointer-events-auto w-[248px] rounded-[18px] glass p-4 shadow-2xl shadow-black/40"
    >
      <ControlsBody />
    </motion.section>
  );
}
