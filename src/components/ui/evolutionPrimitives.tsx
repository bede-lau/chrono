"use client";
/**
 * Building blocks of the Evolution view. OWNER: ui-evolution agent.
 * Monochrome and hairline-separated: 10.5 px uppercase labels, 13 px body, white at 90/60/40 % alpha.
 * Every control is keyboard reachable (radiogroup arrows, switch Space/Enter, native range input).
 */
import { createContext, useContext, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronRight, Copy, Pin } from "lucide-react";
import type { StageRun } from "@/lib/chain/types";
import { MAX_ATTEMPTS, formatLatency, isActive, truncateMiddle } from "./format";
import { ICON, IconButton, T, T_FAST, cx } from "./primitives";

/* ---------------------------------------------------------------- density */

/** `compact` = mobile bottom sheet: tighter gutters, same type scale. */
export const CompactContext = createContext(false);
export const useCompact = () => useContext(CompactContext);
export const gutter = (compact: boolean) => (compact ? "px-4" : "px-5");

/* ---------------------------------------------------------------- layout */

/** A block of the view: full-bleed hairline on top, uppercase label, optional right-hand aside. */
export function Section({ label, aside, children, className }: { label?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  const compact = useCompact();
  return (
    <section className={cx("border-t border-hairline", gutter(compact), compact ? "py-3.5" : "py-4", className)}>
      {(label || aside) && (
        <div className="mb-3 flex min-h-4 items-center justify-between gap-3">
          {label && <h3 className="label">{label}</h3>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

/** Collapsible block (closed by default). Height animates; content is not rendered while closed. */
export function Disclosure({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  const compact = useCompact();
  const id = useId();
  return (
    <section className="border-t border-hairline">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className={cx("group flex w-full items-center gap-2 text-left", gutter(compact), compact ? "py-3.5" : "py-4")}
      >
        <span className="label transition-colors duration-200 group-hover:text-fg-2">{label}</span>
        <ChevronRight size={13} strokeWidth={1.5} aria-hidden className={cx("ml-auto text-fg-3 transition-transform duration-200 ease-out group-hover:text-fg-2", open && "rotate-90")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={id}
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={T_FAST}
            className="overflow-hidden"
          >
            <div className={cx(gutter(compact), "pb-5")}>{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/** Key/value row for a <dl>: mono, tabular, value truncates. */
export function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex min-h-6 items-center justify-between gap-4 font-mono text-[11.5px] tabular">
      <dt className="shrink-0 text-fg-3">{k}</dt>
      <dd className="min-w-0 truncate text-right text-fg-1">{children}</dd>
    </div>
  );
}

/* ---------------------------------------------------------------- controls */

export interface SegmentOption<V extends string> {
  value: V;
  label: string;
}

/**
 * Segmented control (radiogroup). `value = null` highlights nothing (e.g. the lens scrubbed between its two ends);
 * the highlight then fades out in place and slides back in from where it was.
 */
export function Segmented<V extends string>({
  options,
  value,
  onChange,
  label,
  disabled,
  className,
}: {
  options: readonly SegmentOption<V>[];
  value: V | null;
  onChange: (v: V) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const n = options.length;
  const idx = options.findIndex((o) => o.value === value);
  // Remember the last selected segment so the highlight fades out in place (and back in) while value is null.
  const [last, setLast] = useState(Math.max(0, idx));
  if (idx >= 0 && idx !== last) setLast(idx);
  const at = idx >= 0 ? idx : last;

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const j = (i + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) + n) % n;
    onChange(options[j].value);
    (e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=radio]")[j])?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={cx("relative grid rounded-[10px] bg-white/[0.045] p-[3px] transition-opacity duration-200", disabled && "opacity-40", className)}
      style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
    >
      <motion.span
        aria-hidden
        className="pointer-events-none absolute top-[3px] bottom-[3px] left-[3px] rounded-[8px] bg-white/[0.11] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]"
        style={{ width: `calc((100% - 6px) / ${n})` }}
        initial={false}
        animate={{ x: `${at * 100}%`, opacity: idx >= 0 ? 1 : 0 }}
        transition={T}
      />
      {options.map((o, i) => {
        const on = i === idx;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            tabIndex={on || (idx < 0 && i === 0) ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cx(
              "relative h-7 min-w-0 truncate rounded-[8px] px-2 text-[12px] transition-colors duration-200",
              on ? "text-fg-1" : "text-fg-3 enabled:hover:text-fg-2",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** On/off switch row: label left, switch right. The whole row is the hit target. */
export function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className={cx("flex min-h-8 items-center justify-between gap-3 transition-opacity duration-200", disabled && "opacity-40")}>
      <label htmlFor={id} className={cx("min-w-0 truncate text-[12.5px] text-fg-1", !disabled && "cursor-pointer")}>
        {label}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx("relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors duration-200 ease-out", checked ? "bg-[#f4f4f5]" : "bg-white/[0.14]")}
      >
        <span
          aria-hidden
          className={cx(
            "absolute top-[2px] left-[2px] size-[14px] rounded-full shadow-[0_1px_2px_rgb(0_0_0/0.35)] transition-[translate,background-color] duration-200 ease-out",
            checked ? "translate-x-[12px] bg-stage" : "translate-x-0 bg-white/80",
          )}
        />
      </button>
    </div>
  );
}

/** Small "pending" marker: the value differs from what the specimen on screen was computed with. */
export function PendingMark({ text }: { text: string }) {
  return (
    <motion.span
      initial={{ opacity: 0, x: 4 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 4 }}
      transition={T_FAST}
      className="flex items-center gap-1.5 text-[11px] whitespace-nowrap text-fg-3"
    >
      <span aria-hidden className="size-[5px] rounded-full bg-fg-1" />
      {text}
    </motion.span>
  );
}

/** Range slider with label, value, one-line hint and an optional pending marker. Same track/thumb as the Parameters view. */
export function ParamSlider({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
  pending,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  pending?: string | null;
}) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex flex-col">
      <div className="flex min-h-5 items-center justify-between gap-3">
        <label htmlFor={id} className="min-w-0 truncate text-[12.5px] text-fg-1">
          {label}
        </label>
        <span className="flex items-center gap-2.5">
          <AnimatePresence initial={false}>{pending && <PendingMark key="p" text={pending} />}</AnimatePresence>
          <output htmlFor={id} className="font-mono text-[12px] tabular text-fg-1">
            {format(value)}
          </output>
        </span>
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
        aria-describedby={hint ? `${id}-hint` : undefined}
        style={{ ["--fill" as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-0.5 text-[11.5px] leading-[1.45] text-fg-3">
          {hint}
        </p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- values + status */

export function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — the value stays selectable */
    }
  };
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span className="truncate select-all" title={value}>
        {truncateMiddle(value, 10, 6)}
      </span>
      <IconButton label={copied ? "Copied" : label} onClick={copy} size="xs" tipAlign="end" tipSide="top" className="-my-1 -mr-1">
        {copied ? <Check {...ICON} size={13} /> : <Copy {...ICON} size={13} />}
      </IconButton>
    </span>
  );
}

export function StatusPill({ run }: { run?: StageRun }) {
  const s = run?.status ?? "idle";
  const text =
    s === "done"
      ? `Done${run?.latencyMs != null ? ` · ${formatLatency(run.latencyMs)}` : ""}`
      : s === "retrying"
        ? `Retrying · ${run?.attempt ?? 1}/${MAX_ATTEMPTS}`
        : s[0].toUpperCase() + s.slice(1);
  return (
    <span
      className={cx(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 font-mono text-[10.5px] whitespace-nowrap tabular",
        s === "failed" ? "bg-danger-soft text-danger" : "bg-white/[0.06] text-fg-2",
      )}
    >
      <span
        aria-hidden
        className={cx(
          "size-1.5 rounded-full",
          s === "done" && "bg-white/90",
          s === "cached" && "bg-white/35",
          s === "failed" && "bg-danger",
          s === "idle" && "ring-1 ring-white/30",
          isActive(s) && "breathe bg-accent",
        )}
      />
      {text}
    </span>
  );
}

/** Quiet text button that stops following and keeps this engine on screen. */
export function PinButton({ onPin }: { onPin?: () => void }) {
  return (
    <button
      type="button"
      onClick={onPin}
      aria-label="Pin this engine"
      className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[11.5px] text-fg-2 transition-colors duration-200 hover:bg-white/[0.06] hover:text-fg-1"
    >
      <Pin size={12} strokeWidth={1.5} aria-hidden />
      Pin
    </button>
  );
}
