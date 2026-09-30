"use client";
/**
 * Mutation controls + the chain's primary actions, shared by the right panel's Parameters view, the Evolution
 * view (an engine's own controls) and the mobile bar.
 *
 *   <ControlInput control="decay" />   one control, bound to useChrono.controls (same state everywhere)
 *   <ChainActions />                   Create / Evolve (+ New specimen); while a run is in flight: progress + Stop
 */
import { useId, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Plus, Square } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { PARAM_COPY } from "@/lib/chain/stageCopy";
import { STAGES, type Controls } from "@/lib/chain/types";
import { useChrono } from "@/lib/store";
import { canEvolve, newSpecimen, primary, stop } from "./actions";
import { MAX_ATTEMPTS, isActive, isComplete } from "./format";
import { ICON, Spinner, T, T_FAST, cx } from "./primitives";
import { useUi } from "./uiStore";

/* ---------------------------------------------------------------- slider */

export function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  labelAside,
  describedBy,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  /** Rendered right after the label (e.g. a "pending" tag). */
  labelAside?: ReactNode;
  /** id of the element that describes this control (its hint). */
  describedBy?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-baseline gap-2">
          <label htmlFor={id} className="shrink-0 text-[12px] text-fg-2">
            {label}
          </label>
          {labelAside}
        </span>
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
        disabled={disabled}
        aria-valuetext={format(value)}
        aria-describedby={describedBy}
        style={{ ["--fill" as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- machine segmented */

export const MACHINES: { value: Controls["machine"]; label: string }[] = [
  { value: "aer", label: "Ideal" },
  { value: "fake_fez", label: "IBM Fez noise" },
];

export function MachineSegmented({
  value,
  onChange,
  layoutId,
  label = PARAM_COPY.machine.label,
  describedBy,
}: {
  value: Controls["machine"];
  onChange: (v: Controls["machine"]) => void;
  /** Unique per mounted instance (the selection pill glides between options). */
  layoutId: string;
  label?: string;
  describedBy?: string;
}) {
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const next = MACHINES[(i + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) + MACHINES.length) % MACHINES.length];
    onChange(next.value);
    (e.currentTarget.parentElement?.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} aria-describedby={describedBy} className="relative grid grid-cols-2 rounded-[10px] bg-white/[0.045] p-[3px]">
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
            className={cx("relative h-7 rounded-[8px] text-[12px] transition-colors duration-200", on ? "text-fg-1" : "text-fg-3 hover:text-fg-2")}
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

/* ---------------------------------------------------------------- one control, bound to the store */

type NumericControl = Exclude<keyof Controls, "machine">;

export const CONTROL_RANGE: Record<NumericControl, { min: number; max: number; step: number; format: (v: number) => string }> = {
  circuitDepth: { min: 1, max: 12, step: 1, format: (v) => String(v) },
  entanglement: { min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
  decay: { min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
};

/** Differs from what the specimen on screen was grown/evolved with (floats compared with a tolerance). */
export function isPending(key: keyof Controls, current: Controls, applied?: Controls): boolean {
  if (!applied) return false;
  const a = current[key];
  const b = applied[key];
  return typeof a === "number" && typeof b === "number" ? Math.abs(a - b) > 1e-6 : a !== b;
}

/**
 * A mutation control bound to `useChrono.controls`: the Parameters view and an engine's Evolution view render the
 * same widget over the same state. Label comes from PARAM_COPY.
 */
export function ControlInput({
  control,
  layoutId,
  labelAside,
  describedBy,
}: {
  control: keyof Controls;
  /** Required for "machine" when more than one instance is mounted. */
  layoutId?: string;
  labelAside?: ReactNode;
  describedBy?: string;
}) {
  const value = useChrono((s) => s.controls[control]);
  const setControls = useChrono((s) => s.setControls);
  const autoId = useId();
  const label = PARAM_COPY[control].label;

  if (control === "machine") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[12px] text-fg-2">{label}</span>
          {labelAside}
        </div>
        <MachineSegmented
          value={value as Controls["machine"]}
          onChange={(machine) => setControls({ machine })}
          layoutId={layoutId ?? `machine-${autoId}`}
          label={label}
          describedBy={describedBy}
        />
      </div>
    );
  }
  const r = CONTROL_RANGE[control];
  return (
    <Slider
      label={label}
      value={value as number}
      min={r.min}
      max={r.max}
      step={r.step}
      format={r.format}
      onChange={(v) => setControls({ [control]: v } as Partial<Controls>)}
      labelAside={labelAside}
      describedBy={describedBy}
    />
  );
}

/* ---------------------------------------------------------------- run progress */

export function useRunProgress() {
  const { runs, mode, activeStage, pendingWounds, hasSpecimen, evolvable } = useChrono(
    useShallow((s) => ({
      runs: s.runs,
      mode: s.mode,
      activeStage: s.activeStage,
      pendingWounds: s.pendingWounds.length,
      hasSpecimen: !!s.specimen,
      evolvable: canEvolve(s.specimen),
    })),
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
    /** Primary reads Evolve (else Create). */
    canEvolve: evolvable,
  };
}

/* ---------------------------------------------------------------- primary actions */

const secondaryButton =
  "flex items-center justify-center gap-1.5 rounded-[11px] text-[12.5px] text-fg-2 shadow-[inset_0_0_0_1px_var(--hairline-strong)] transition-colors duration-200 hover:bg-white/5 hover:text-fg-1 disabled:opacity-40";

/** Create / Evolve (+ New specimen when stacked); while the chain runs: live progress + Stop. */
export function ChainActions({ layout = "stack" }: { layout?: "stack" | "row" }) {
  const p = useRunProgress();
  const running = p.busy && !p.loading;
  const pct = p.total ? (p.done / p.total) * 100 : 0;
  const label = p.canEvolve ? "Evolve" : "Create";
  const badge = p.canEvolve ? p.wounds : 0;

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
            aria-label={`${p.evolving ? "Evolving" : "Creating"}: ${p.current?.title ?? "starting"}, ${p.done} of ${p.total} stages`}
            className={cx(
              "relative flex h-10 min-w-0 items-center gap-2.5 overflow-hidden rounded-[11px] bg-white/[0.07] px-3.5 text-[13px] text-fg-1 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]",
              layout === "row" ? "flex-1" : "w-full",
            )}
          >
            <Spinner size={14} className="shrink-0 text-accent" />
            <span className="min-w-0 truncate">
              {p.current?.title ?? (p.evolving ? "Evolving" : "Creating")}
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
            key="primary"
            type="button"
            data-accent-focus
            data-primary-action
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={T_FAST}
            disabled={p.busy}
            onClick={primary}
            aria-keyshortcuts="Space"
            aria-label={p.loading ? "Opening specimen" : badge > 0 ? `${label}, ${badge} pending wound${badge === 1 ? "" : "s"}` : label}
            className={cx(
              "group relative flex h-10 min-w-0 items-center justify-center gap-2 rounded-[11px] bg-[#f4f4f5] text-[13px] font-medium text-black transition-[background-color,opacity,transform] duration-200 ease-out hover:bg-white active:scale-[0.985] disabled:bg-white/10 disabled:text-fg-3",
              layout === "row" ? "flex-1" : "w-full",
            )}
          >
            {p.loading && <Spinner size={13} className="shrink-0" />}
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={label} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={T_FAST}>
                {label}
              </motion.span>
            </AnimatePresence>
            <AnimatePresence initial={false}>
              {badge > 0 && (
                <motion.span
                  key="badge"
                  initial={{ opacity: 0, scale: 0.6, width: 0 }}
                  animate={{ opacity: 1, scale: 1, width: "auto" }}
                  exit={{ opacity: 0, scale: 0.6, width: 0 }}
                  transition={T_FAST}
                  className="grid h-5 min-w-5 place-items-center rounded-full bg-black px-1.5 font-mono text-[10.5px] tabular text-white"
                  aria-hidden
                >
                  <motion.span key={badge} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={T_FAST}>
                    {badge}
                  </motion.span>
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        )}
      </AnimatePresence>

      {running ? (
        <button type="button" onClick={stop} aria-label="Stop" className={cx(secondaryButton, layout === "stack" ? "h-9 w-full" : "h-10 w-10 shrink-0")}>
          <Square size={12} strokeWidth={1.75} />
          {layout === "stack" && "Stop"}
        </button>
      ) : (
        layout === "stack" &&
        p.hasSpecimen && (
          <button type="button" onClick={newSpecimen} disabled={p.busy} aria-keyshortcuts="N" className={cx(secondaryButton, "h-9 w-full")}>
            <Plus {...ICON} size={14} />
            New specimen
          </button>
        )
      )}
    </div>
  );
}
