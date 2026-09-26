"use client";
import { memo, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Check, X } from "lucide-react";
import { STAGES, type StageMeta, type StageRun, type StageStatus } from "@/lib/chain/types";
import { useChrono } from "@/lib/store";
import { MAX_ATTEMPTS, formatElapsed, formatLatency, isActive, isComplete, pad2, statusText } from "./format";
import { EASE_OUT, cx } from "./primitives";

/* ---------------------------------------------------------------- marker */

function Marker({ status, selected }: { status: StageStatus; selected: boolean }) {
  const active = status === "running" || status === "queued" || status === "uploading";
  return (
    <span className="relative grid size-[18px] place-items-center">
      {/* Only the active stage glows, in the specimen's hue. */}
      <span
        aria-hidden
        className={cx(
          "absolute inset-[-3px] rounded-full transition-opacity duration-400 ease-out",
          status === "running" ? "opacity-100" : "opacity-0",
        )}
        style={{ boxShadow: "0 0 16px 2px var(--accent-soft)", background: "radial-gradient(circle, var(--accent-faint), transparent 70%)" }}
      />
      <svg viewBox="0 0 18 18" width={18} height={18} className="relative overflow-visible" aria-hidden>
        {selected && <circle cx="9" cy="9" r="8.25" fill="none" stroke="white" strokeOpacity="0.35" strokeWidth="1" />}
        {status === "idle" && <circle cx="9" cy="9" r="4" fill="var(--bg)" stroke="white" strokeOpacity="0.28" strokeWidth="1" />}
        {active && (
          <>
            <circle cx="9" cy="9" r="5.25" fill="var(--bg)" stroke="white" strokeOpacity="0.14" strokeWidth="1.25" />
            <g className={status === "running" ? "spin" : "spin-slow"}>
              <path
                d="M9 3.75a5.25 5.25 0 0 1 5.25 5.25"
                fill="none"
                stroke={status === "running" ? "var(--accent)" : "white"}
                strokeOpacity={status === "running" ? 1 : 0.55}
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </g>
            {status === "running" && <circle cx="9" cy="9" r="1.75" fill="var(--accent)" />}
          </>
        )}
        {status === "retrying" && (
          <>
            <g className="spin-slow">
              <circle cx="9" cy="9" r="5.25" fill="var(--bg)" stroke="white" strokeOpacity="0.7" strokeWidth="1.25" strokeDasharray="2 2.12" />
            </g>
            <circle cx="9" cy="9" r="1.75" fill="white" fillOpacity="0.6" />
          </>
        )}
        {status === "done" && <circle cx="9" cy="9" r="4.5" fill="white" fillOpacity="0.92" />}
        {status === "cached" && <circle cx="9" cy="9" r="4.5" fill="white" fillOpacity="0.32" />}
        {status === "failed" && (
          <>
            <circle cx="9" cy="9" r="5" fill="var(--danger-soft)" stroke="var(--danger)" strokeWidth="1.25" />
            <path d="M7.4 7.4l3.2 3.2M10.6 7.4l-3.2 3.2" stroke="var(--danger)" strokeWidth="1.25" strokeLinecap="round" />
          </>
        )}
      </svg>
    </span>
  );
}

/* ---------------------------------------------------------------- status line */

function Elapsed({ since }: { since?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!since) return null;
  return <>{formatElapsed(Math.max(0, now - since))}</>;
}

function StatusLine({ run }: { run?: StageRun }) {
  const s = run?.status ?? "idle";
  const base = "flex items-center justify-center gap-1 font-mono text-[10.5px] leading-[14px] tabular whitespace-nowrap";
  switch (s) {
    case "done":
      return (
        <span className={cx(base, "text-fg-2")}>
          <Check size={10} strokeWidth={2} aria-hidden />
          {run?.latencyMs != null ? formatLatency(run.latencyMs) : "Done"}
        </span>
      );
    case "cached":
      return <span className={cx(base, "text-fg-3")}>Cached</span>;
    case "failed":
      return (
        <span className={cx(base, "text-danger")}>
          <X size={10} strokeWidth={2} aria-hidden />
          Failed
        </span>
      );
    case "retrying":
      return (
        <span className={cx(base, "text-fg-1")}>
          Retry {run?.attempt ?? 1}/{MAX_ATTEMPTS}
        </span>
      );
    case "running":
      return (
        <span className={cx(base, "text-fg-1")}>
          <Elapsed since={run?.startedAt} />
          {!run?.startedAt && "Running"}
        </span>
      );
    case "queued":
    case "uploading":
      return <span className={cx(base, "text-fg-2")}>{s === "queued" ? "Queued" : "Uploading"}</span>;
    default:
      return <span className={cx(base, "text-fg-4")}>—</span>;
  }
}

/* ---------------------------------------------------------------- link */

function Link({ lit, pulse }: { lit: boolean; pulse: number }) {
  return (
    <span aria-hidden className="pointer-events-none absolute top-[9px] left-[calc(50%+13px)] right-[calc(-50%+13px)] h-px">
      <span className="absolute inset-0 bg-white/[0.09]" />
      <motion.span
        className="absolute inset-0 origin-left bg-white/[0.34]"
        initial={false}
        animate={{ scaleX: lit ? 1 : 0 }}
        transition={{ duration: 0.4, ease: EASE_OUT }}
      />
      {pulse > 0 && (
        <motion.span
          key={pulse}
          className="absolute top-1/2 h-[3px] w-10 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: "radial-gradient(closest-side, rgb(255 255 255 / 0.95), rgb(255 255 255 / 0))", boxShadow: "0 0 10px 1px var(--accent-soft)" }}
          initial={{ left: "0%", opacity: 0 }}
          animate={{ left: "100%", opacity: [0, 1, 1, 0] }}
          transition={{ duration: 0.75, ease: EASE_OUT, opacity: { duration: 0.75, times: [0, 0.15, 0.7, 1] } }}
        />
      )}
    </span>
  );
}

/* ---------------------------------------------------------------- node */

const Node = memo(function Node({
  stage,
  run,
  selected,
  compact,
  link,
  onSelect,
}: {
  stage: StageMeta;
  run?: StageRun;
  selected: boolean;
  compact: boolean;
  link?: { lit: boolean; pulse: number };
  onSelect: (id: StageMeta["id"]) => void;
}) {
  const status = run?.status ?? "idle";
  const live = isActive(status);
  return (
    <li className={cx("relative flex justify-center", compact ? "w-[124px] shrink-0 snap-center" : "min-w-0")} data-stage={stage.id}>
      {link && <Link {...link} />}
      <button
        type="button"
        onClick={() => onSelect(stage.id)}
        aria-label={`${pad2(stage.index + 1)} ${stage.title}, ${stage.engineName}: ${statusText(run)}. Open inspector`}
        aria-current={selected ? "true" : undefined}
        aria-keyshortcuts={String(stage.index + 1)}
        className={cx(
          "group relative flex min-w-0 flex-col items-center rounded-[10px] px-1.5 pb-1 outline-offset-0 transition-colors duration-200",
          compact ? "w-full" : "w-full max-w-[140px]",
        )}
      >
        <Marker status={status} selected={selected} />
        <span className={cx("mt-2 flex max-w-full items-baseline gap-1.5 whitespace-nowrap", compact ? "text-[11.5px]" : "text-[12px]")}>
          <span className="font-mono text-[10px] tabular text-fg-3">{pad2(stage.index + 1)}</span>
          <span
            className={cx(
              "truncate font-medium transition-colors duration-200",
              selected || live ? "text-fg-1" : status === "idle" ? "text-fg-3 group-hover:text-fg-2" : "text-fg-2 group-hover:text-fg-1",
            )}
          >
            {stage.title}
          </span>
        </span>
        {!compact && <span className="mt-0.5 max-w-full truncate text-[11px] leading-[14px] text-fg-3">{stage.engineName}</span>}
        <span className="mt-0.5">
          <StatusLine run={run} />
        </span>
      </button>
    </li>
  );
});

/* ---------------------------------------------------------------- rail */

function announce(stage: StageMeta, run: StageRun): string | null {
  switch (run.status) {
    case "running":
      return `${stage.title} running on ${stage.engineName}`;
    case "retrying":
      return `${stage.title} retrying, attempt ${run.attempt} of ${MAX_ATTEMPTS}`;
    case "done":
      return `${stage.title} done${run.latencyMs != null ? ` in ${formatLatency(run.latencyMs)}` : ""}`;
    case "failed":
      return `${stage.title} failed. Lifecycle halted`;
    default:
      return null;
  }
}

export function ChainRail({ compact = false }: { compact?: boolean }) {
  const runs = useChrono((s) => s.runs);
  const selected = useChrono((s) => s.selectedStage);
  const selectStage = useChrono((s) => s.selectStage);
  const [pulses, setPulses] = useState<number[]>(() => STAGES.map(() => 0));
  const [message, setMessage] = useState("");
  const scroller = useRef<HTMLOListElement>(null);

  // Hand-over pulses + screen-reader announcements, driven by status transitions.
  useEffect(
    () =>
      useChrono.subscribe((s, prev) => {
        if (s.runs === prev.runs) return;
        STAGES.forEach((stage, i) => {
          const a = prev.runs[stage.id];
          const b = s.runs[stage.id];
          if (!b || a?.status === b.status) return;
          const text = announce(stage, b);
          if (text) setMessage(text);
          if (i > 0 && isActive(b.status) && !isActive(a?.status)) {
            setPulses((p) => p.map((n, j) => (j === i - 1 ? n + 1 : n)));
          }
        });
      }),
    [],
  );

  // Mobile: keep the live stage in view.
  const activeId = STAGES.find((s) => isActive(runs[s.id]?.status))?.id ?? selected;
  useEffect(() => {
    if (!compact || !activeId) return;
    const el = scroller.current?.querySelector<HTMLElement>(`[data-stage="${activeId}"]`);
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [compact, activeId]);

  return (
    <nav aria-label="Daisy chain" className="pointer-events-auto w-full">
      <ol
        ref={scroller}
        className={cx(
          "relative",
          compact ? "no-scrollbar flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain px-3 py-1" : "grid grid-cols-8",
        )}
      >
        {STAGES.map((stage, i) => {
          const next = STAGES[i + 1];
          const link = next
            ? { lit: isComplete(runs[stage.id]?.status) && (isComplete(runs[next.id]?.status) || isActive(runs[next.id]?.status)), pulse: pulses[i] }
            : undefined;
          return (
            <Node
              key={stage.id}
              stage={stage}
              run={runs[stage.id]}
              selected={selected === stage.id}
              compact={compact}
              link={link}
              onSelect={(id) => selectStage(selected === id ? null : id)}
            />
          );
        })}
      </ol>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {message}
      </p>
    </nav>
  );
}
