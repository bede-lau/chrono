"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { STAGES, type StageMeta, type StageRun } from "@/lib/chain/types";
import { useChrono } from "@/lib/store";
import { ArtifactPreview } from "./artifacts";
import { MAX_ATTEMPTS, formatLatency, formatParam, isActive, pad2, truncateMiddle } from "./format";
import { Panel, PanelClose } from "./Panel";
import { ICON, IconButton, T_FAST, cx } from "./primitives";

function Section({ label, aside, children, className }: { label: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx("border-t border-hairline px-5 py-4", className)}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="label">{label}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-6 items-center justify-between gap-4 font-mono text-[11.5px] tabular">
      <dt className="shrink-0 text-fg-3">{k}</dt>
      <dd className="min-w-0 truncate text-right text-fg-1">{children}</dd>
    </div>
  );
}

function CopyValue({ value, label }: { value: string; label: string }) {
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
      <IconButton label={copied ? "Copied" : label} onClick={copy} size="xs" tipAlign="end" className="-my-1 -mr-1">
        {copied ? <Check {...ICON} size={13} /> : <Copy {...ICON} size={13} />}
      </IconButton>
    </span>
  );
}

function StatusPill({ run }: { run?: StageRun }) {
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
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 font-mono text-[10.5px] tabular",
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

function StageBody({ stage }: { stage: StageMeta }) {
  const specimen = useChrono((s) => s.specimen);
  const run = useChrono((s) => s.runs[stage.id]);
  const params = run?.params ? Object.entries(run.params) : [];
  const inputs = run?.inputs ? Object.entries(run.inputs) : [];

  return (
    <>
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3 px-5 pb-4">
        <div className="min-w-0">
          <div className="label mb-1.5">Consumes</div>
          <div className="text-[12.5px] leading-snug text-fg-1">{stage.consumes}</div>
        </div>
        <ArrowRight size={14} strokeWidth={1.5} className="mt-[17px] text-fg-3" aria-hidden />
        <div className="min-w-0">
          <div className="label mb-1.5">Produces</div>
          <div className="text-[12.5px] leading-snug text-fg-1">{stage.produces}</div>
        </div>
      </div>

      <Section
        label="Artifact"
        aside={
          isActive(run?.status) && (
            <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-fg-3">
              <span aria-hidden className="breathe size-1.5 rounded-full bg-accent" />
              computing
            </span>
          )
        }
      >
        <div className={cx("transition-opacity duration-300", isActive(run?.status) && "opacity-40")}>
          <ArtifactPreview stage={stage.id} specimen={specimen} active={isActive(run?.status)} />
        </div>
      </Section>

      {run?.note && (
        <Section label="Coupling">
          <p className="font-mono text-[11.5px] leading-[1.6] text-fg-1">{run.note}</p>
        </Section>
      )}

      {run?.error && (
        <Section label="Error">
          <p className="rounded-[8px] bg-danger-soft px-3 py-2 font-mono text-[11px] leading-[1.5] text-danger">{run.error}</p>
        </Section>
      )}

      {params.length > 0 && (
        <Section label="Parameters">
          <dl className="flex flex-col">
            {params.map(([k, v]) => (
              <Row key={k} k={k}>
                {formatParam(v)}
              </Row>
            ))}
          </dl>
        </Section>
      )}

      {run && (run.jobId || run.latencyMs != null || run.attempt > 0) && (
        <Section label="Run" className="pb-5">
          <dl className="flex flex-col">
            {run.jobId && (
              <Row k="job">
                <CopyValue value={run.jobId} label="Copy job id" />
              </Row>
            )}
            <Row k="latency">{formatLatency(run.latencyMs)}</Row>
            <Row k="attempts">
              {Math.max(1, run.attempt)}/{MAX_ATTEMPTS}
            </Row>
            {inputs.map(([slot, id]) => (
              <Row key={slot} k={`in:${slot}`}>
                <CopyValue value={id} label="Copy asset id" />
              </Row>
            ))}
          </dl>
        </Section>
      )}
    </>
  );
}

export function Inspector({ mobile }: { mobile: boolean }) {
  const selected = useChrono((s) => s.selectedStage);
  const selectStage = useChrono((s) => s.selectStage);
  const run = useChrono((s) => (s.selectedStage ? s.runs[s.selectedStage] : undefined));
  const stage = STAGES.find((s) => s.id === selected);
  const close = () => selectStage(null);
  const step = (d: -1 | 1) => stage && selectStage(STAGES[(stage.index + d + STAGES.length) % STAGES.length].id);

  return (
    <Panel open={!!stage} onClose={close} label={stage ? `${stage.title} inspector` : "Inspector"} mobile={mobile}>
      {stage && (
        <>
          <header className="shrink-0 px-5 pt-3.5 pb-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10.5px] tabular text-fg-3">
                {pad2(stage.index + 1)} / {pad2(STAGES.length)}
              </span>
              <div className="-mr-2 flex items-center">
                <IconButton label="Previous stage" kbd="←" onClick={() => step(-1)} size="sm">
                  <ChevronLeft {...ICON} />
                </IconButton>
                <IconButton label="Next stage" kbd="→" onClick={() => step(1)} size="sm">
                  <ChevronRight {...ICON} />
                </IconButton>
                <PanelClose onClose={close} />
              </div>
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={stage.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={T_FAST}>
                <h2 className="mt-1 text-[20px] leading-7 font-semibold tracking-[-0.02em] text-fg-1">{stage.title}</h2>
                <p className="mt-0.5 flex items-baseline gap-1.5 text-[12px] text-fg-2">
                  {stage.engineName}
                  <span className="font-mono text-[11px] text-fg-3">{stage.engineId}</span>
                </p>
                <div className="mt-3">
                  <StatusPill run={run} />
                </div>
              </motion.div>
            </AnimatePresence>
          </header>
          <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={stage.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={T_FAST}>
                <StageBody stage={stage} />
              </motion.div>
            </AnimatePresence>
          </div>
        </>
      )}
    </Panel>
  );
}
