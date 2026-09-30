"use client";
/**
 * The Evolution view of the right panel: everything about ONE engine (stage).
 * OWNER: ui-evolution agent (the ui-shell agent only renders <EvolutionView ... /> inside RightPanel).
 *
 * Contract (props are fixed — add optional ones only):
 *   stage      the engine to show
 *   compact    mobile bottom sheet (tighter spacing)
 *   following  true while the panel is auto-following the RUNNING stage during Create/Evolve.
 *              In that mode the view must NOT set the Chrono Lens (leave it off so the growth reveal plays);
 *              show a small "Live" pill and a "Pin" button that calls onPin.
 *   onPin      the shell stops following and keeps this stage; the view then owns the lens for `stage`.
 *
 * Layout: the view brings its own horizontal gutters (20 px, 16 px compact) and full-bleed hairlines between
 * sections, and does not scroll itself — mount it edge to edge inside the panel's scroll container.
 *
 * Order: 1 stage header · 2 What it does · 3 On the organism (+ Chrono Lens) · 4 the engine's controls ·
 * 5 artifacts (linked probe) · 6 Run details (collapsed).
 *
 * Lens: on mount / stage change → setLens({ stage, amount 1, compare off, overlay on }); unmount → LENS_OFF.
 * While `following`, the lens is kept off. Only the instance that last wrote the lens resets it on unmount, so a
 * crossfade (old view unmounting after the new one mounted) never switches the new stage's lens off.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { PARAM_COPY, STAGE_COPY } from "@/lib/chain/stageCopy";
import { LENS_OFF, STAGES, type Controls, type LensState, type Specimen, type StageId } from "@/lib/chain/types";
import { useChrono } from "@/lib/store";
import { ArtifactPreview, hasArtifact } from "./artifacts";
import {
  CompactContext,
  CopyValue,
  Disclosure,
  LivePill,
  ParamSlider,
  PendingMark,
  PinButton,
  Row,
  Section,
  Segmented,
  StatusPill,
  Toggle,
  gutter,
  useCompact,
} from "./evolutionPrimitives";
import { MAX_ATTEMPTS, formatLatency, formatParam, isActive, isComplete, pad2 } from "./format";
import { T_FAST, cx } from "./primitives";

export interface EvolutionViewProps {
  stage: StageId;
  compact?: boolean;
  following?: boolean;
  onPin?: () => void;
}

/* ---------------------------------------------------------------- lens wiring */

/** The EvolutionView instance that last wrote the lens (see header). */
let lensOwner: symbol | null = null;

type LensPatch = Partial<Omit<LensState, "stage">>;

function useLensWiring(stage: StageId, following: boolean, onPin?: () => void) {
  const [me] = useState(() => Symbol("evolution-view"));
  // A lens change made while following pins the stage; it is re-applied once the shell stops following.
  const carry = useRef<LensPatch | null>(null);

  useEffect(() => {
    lensOwner = me;
    const st = useChrono.getState();
    if (following) {
      st.setLens(LENS_OFF);
      return;
    }
    st.setLens({ stage, amount: 1, compare: false, overlay: true, ...carry.current });
    carry.current = null;
  }, [me, stage, following]);

  useEffect(
    () => () => {
      if (lensOwner !== me) return;
      lensOwner = null;
      useChrono.getState().setLens(LENS_OFF);
    },
    [me],
  );

  return useCallback(
    (p: LensPatch) => {
      lensOwner = me;
      if (following) {
        carry.current = { ...carry.current, ...p };
        onPin?.();
      }
      useChrono.getState().setLens({ ...p, stage });
    },
    [me, stage, following, onPin],
  );
}

/* ---------------------------------------------------------------- header */

function StageHeader({ stage, following, onPin }: { stage: StageId; following: boolean; onPin?: () => void }) {
  const compact = useCompact();
  const meta = STAGES[STAGES.findIndex((s) => s.id === stage)];
  const run = useChrono((s) => s.runs[stage]);
  const hasSpecimen = useChrono((s) => !!s.specimen);
  const showStatus = hasSpecimen || (run && run.status !== "idle");
  return (
    <header className={cx(gutter(compact), compact ? "pt-2 pb-4" : "pt-4 pb-5")}>
      {following && (
        <div className="-mr-1.5 mb-2.5 flex items-center justify-between gap-3">
          <LivePill />
          <PinButton onPin={onPin} />
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <h2 className={cx("min-w-0 font-semibold tracking-[-0.02em] text-fg-1", compact ? "text-[18px] leading-7" : "text-[20px] leading-7")}>
          <span className="tabular text-fg-3">{pad2(meta.index + 1)}</span>
          <span aria-hidden className="px-[0.35em] text-fg-3">
            ·
          </span>
          {meta.title}
        </h2>
        {showStatus && (
          <div className="pt-0.5">
            <StatusPill run={run} />
          </div>
        )}
      </div>
      <p className="mt-0.5 text-[13px] leading-snug text-fg-2">{STAGE_COPY[stage].gist}</p>
      <p className="mt-3 flex min-w-0 items-baseline gap-1.5 truncate text-[12px]">
        <span className="text-fg-2">{meta.engineName}</span>
        <span className="font-mono text-[11px] text-fg-3">{meta.engineId}</span>
      </p>
    </header>
  );
}

/* ---------------------------------------------------------------- 3 · On the organism (Chrono Lens) */

function LensControls({ stage, available, reason, onLens }: { stage: StageId; available: boolean; reason: string; onLens: (p: LensPatch) => void }) {
  const lens = useChrono((s) => s.lens);
  const copy = STAGE_COPY[stage].lens;
  const mine = lens.stage === stage;
  const amount = mine ? lens.amount : 1;
  const compare = mine && lens.compare;
  const overlay = mine ? lens.overlay : true;
  const end = amount <= 0.001 ? "without" : amount >= 0.999 ? "with" : null;
  const pct = Math.round(amount * 100);
  const off = !available;

  return (
    <div className="mt-4 flex flex-col">
      {off && <p className="mb-2.5 text-[11.5px] text-fg-3">{reason}</p>}
      <Segmented
        label="Chrono Lens"
        options={[
          { value: "without", label: copy.without },
          { value: "with", label: copy.with },
        ]}
        value={end}
        onChange={(v) => onLens({ amount: v === "with" ? 1 : 0, compare: false })}
        disabled={off}
      />
      <div className="mt-1.5 flex items-center gap-3">
        <input
          type="range"
          className="slider"
          min={0}
          max={1}
          step={0.005}
          value={amount}
          disabled={off}
          aria-label={`${copy.without} to ${copy.with}`}
          aria-valuetext={`${pct}%`}
          style={{ ["--fill" as string]: `${amount * 100}%` }}
          onChange={(e) => onLens({ amount: Number(e.target.value), compare: false })}
        />
        <output className={cx("w-10 shrink-0 text-right font-mono text-[12px] tabular text-fg-1 transition-opacity duration-200", off && "opacity-40")}>{pct}%</output>
      </div>
      <div className="mt-1.5 flex flex-col">
        <Toggle label="Compare" checked={compare} onChange={(c) => onLens({ compare: c, amount: c ? 1 : amount })} disabled={off} />
        <AnimatePresence initial={false}>
          {compare && !off && (
            <motion.p
              key="cap"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={T_FAST}
              className="overflow-hidden text-[11.5px] text-fg-3"
            >
              <span className="block pb-1.5">
                Left: {copy.without} · Right: {copy.with}
              </span>
            </motion.p>
          )}
        </AnimatePresence>
        <Toggle label={copy.overlay} checked={overlay} onChange={(o) => onLens({ overlay: o })} disabled={off} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 4 · the engine's own controls */

type SliderKey = Exclude<keyof Controls, "machine">;
const SLIDERS: Record<SliderKey, { min: number; max: number; step: number; format: (v: number) => string }> = {
  circuitDepth: { min: 1, max: 12, step: 1, format: (v) => String(v) },
  entanglement: { min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
  decay: { min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
};
const MACHINES = [
  { value: "aer", label: "Ideal" },
  { value: "fake_fez", label: "IBM Fez noise" },
] as const;

/** What the specimen on screen was actually computed with. The simulator only runs in Create (Evolve re-uses the skin). */
function appliedValue(s: Specimen, k: keyof Controls): unknown {
  if (k === "machine") {
    const m = s.runs.morphogenesis?.params?.machine;
    return typeof m === "string" ? m : s.controls.machine;
  }
  return s.controls[k];
}

function differs(a: unknown, b: unknown) {
  return typeof a === "number" && typeof b === "number" ? Math.abs(a - b) > 1e-6 : a !== b;
}

function EngineControls({ keys }: { keys: (keyof Controls)[] }) {
  const controls = useChrono((s) => s.controls);
  const specimen = useChrono((s) => s.specimen);
  const setControls = useChrono((s) => s.setControls);
  const pending = (k: keyof Controls) =>
    specimen && differs(controls[k], appliedValue(specimen, k)) ? (k === "machine" ? "applies on Create" : "applies on Evolve") : null;

  return (
    <div className="flex flex-col gap-4">
      {keys.map((k) => {
        const copy = PARAM_COPY[k];
        if (k === "machine") {
          const p = pending(k);
          return (
            <div key={k} className="flex flex-col">
              <div className="mb-1.5 flex min-h-5 items-center justify-between gap-3">
                <span className="text-[12.5px] text-fg-1">{copy.label}</span>
                <AnimatePresence initial={false}>{p && <PendingMark key="p" text={p} />}</AnimatePresence>
              </div>
              <Segmented label={copy.label} options={MACHINES} value={controls.machine} onChange={(machine) => setControls({ machine })} />
              <p className="mt-1.5 text-[11.5px] leading-[1.45] text-fg-3">{copy.hint}</p>
            </div>
          );
        }
        const cfg = SLIDERS[k];
        return (
          <ParamSlider
            key={k}
            label={copy.label}
            hint={copy.hint}
            value={controls[k]}
            min={cfg.min}
            max={cfg.max}
            step={cfg.step}
            format={cfg.format}
            onChange={(v) => setControls({ [k]: v })}
            pending={pending(k)}
          />
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- 6 · Run details */

let runDetailsOpen = false;

function SubBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="label mb-2 text-[10px]">{label}</h4>
      {children}
    </div>
  );
}

function RunDetails({ stage }: { stage: StageId }) {
  const run = useChrono((s) => s.runs[stage]);
  const [open, setOpen] = useState(runDetailsOpen);
  const toggle = () => {
    runDetailsOpen = !open;
    setOpen(!open);
  };
  const meta = STAGES[STAGES.findIndex((s) => s.id === stage)];
  const params = run?.params ? Object.entries(run.params) : [];
  const inputs = run?.inputs ? Object.entries(run.inputs) : [];
  const hasJob = !!run && (!!run.jobId || run.latencyMs != null || run.attempt > 0);

  return (
    <Disclosure label="Run details" open={open} onToggle={toggle}>
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3">
          <div className="min-w-0">
            <div className="label mb-1.5 text-[10px]">Consumes</div>
            <div className="text-[12.5px] leading-snug text-fg-1">{meta.consumes}</div>
          </div>
          <ArrowRight size={13} strokeWidth={1.5} className="mt-[15px] text-fg-3" aria-hidden />
          <div className="min-w-0">
            <div className="label mb-1.5 text-[10px]">Produces</div>
            <div className="text-[12.5px] leading-snug text-fg-1">{meta.produces}</div>
          </div>
        </div>
        {run?.note && (
          <SubBlock label="Coupling">
            <p className="font-mono text-[11.5px] leading-[1.6] break-words text-fg-1">{run.note}</p>
          </SubBlock>
        )}
        {params.length > 0 && (
          <SubBlock label="Params sent">
            <dl className="flex flex-col">
              {params.map(([k, v]) => (
                <Row key={k} k={k}>
                  {formatParam(v)}
                </Row>
              ))}
            </dl>
          </SubBlock>
        )}
        {hasJob && (
          <SubBlock label="Job">
            <dl className="flex flex-col">
              {run.jobId && (
                <Row k="id">
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
          </SubBlock>
        )}
      </div>
    </Disclosure>
  );
}

/* ---------------------------------------------------------------- view */

export function EvolutionView({ stage, compact = false, following = false, onPin }: EvolutionViewProps) {
  const onLens = useLensWiring(stage, following, onPin);
  const specimen = useChrono((s) => s.specimen);
  const run = useChrono((s) => s.runs[stage]);
  const mode = useChrono((s) => s.mode);
  const copy = STAGE_COPY[stage];
  const status = run?.status;
  const active = isActive(status);
  const lensReady = !!specimen && isComplete(status);
  const has = hasArtifact(stage, specimen);

  return (
    <CompactContext.Provider value={compact}>
      <div className="flex flex-col" data-evolution-stage={stage}>
        <StageHeader stage={stage} following={following} onPin={onPin} />

        <Section label="What it does">
          <p className="text-[13px] leading-[1.55] text-fg-1">{copy.what}</p>
        </Section>

        <Section label="On the organism">
          <p className="text-[13px] leading-[1.55] text-fg-1">{copy.onBlob}</p>
          <LensControls stage={stage} available={lensReady} reason={specimen ? "Available once this engine finishes" : "Available after Create"} onLens={onLens} />
        </Section>

        {copy.controls.length > 0 && (
          <Section label="Controls">
            <EngineControls keys={copy.controls} />
          </Section>
        )}

        <Section
          label="Artifacts"
          aside={
            active &&
            has && (
              <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-fg-3">
                <span aria-hidden className="breathe size-1.5 rounded-full bg-accent" />
                computing
              </span>
            )
          }
        >
          {status === "failed" && run?.error && (
            <p className="mb-3 rounded-[8px] bg-danger-soft px-3 py-2 font-mono text-[11px] leading-[1.5] break-words text-danger">{run.error}</p>
          )}
          <div className={cx("transition-opacity duration-300", active && has && "opacity-40")}>
            <ArtifactPreview
              stage={stage}
              specimen={specimen}
              active={active}
              waiting={!specimen ? "Waiting for Create" : mode !== "idle" ? "Queued" : "Not computed yet"}
            />
          </div>
        </Section>

        <RunDetails stage={stage} />
      </div>
    </CompactContext.Provider>
  );
}

export default EvolutionView;
