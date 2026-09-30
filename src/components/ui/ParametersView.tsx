"use client";
/**
 * Parameters view of the right panel: the four mutation controls, each with its plain-English hint and links to
 * the engine(s) it steers. All copy comes from PARAM_COPY.
 */
import { useId, type MouseEvent } from "react";
import { ArrowRight } from "lucide-react";
import { PARAM_COPY } from "@/lib/chain/stageCopy";
import { STAGES, type Controls, type StageId } from "@/lib/chain/types";
import { useChrono } from "@/lib/store";
import { canEvolve, openStage } from "./actions";
import { ControlInput, isPending } from "./ControlsCard";
import { pad2 } from "./format";
import { cx } from "./primitives";

const ORDER: (keyof Controls)[] = ["circuitDepth", "entanglement", "decay", "machine"];

/** Keyboard users keep their place: after the view swaps, focus lands on the new view instead of <body>. */
export function focusPanelView() {
  requestAnimationFrame(() => document.getElementById("chrono-panel-view")?.focus({ preventScroll: true }));
}

/** "→ 04 Decoherence": opens that engine's Evolution view at once. */
export function StageChip({ id }: { id: StageId }) {
  const stage = STAGES.find((s) => s.id === id)!;
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    const keyboard = e.currentTarget.matches(":focus-visible");
    openStage(id);
    if (keyboard) focusPanelView();
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${pad2(stage.index + 1)} ${stage.title}: open engine`}
      className="inline-flex h-6 items-center gap-1 rounded-full pr-2.5 pl-2 text-[11px] leading-none text-fg-2 shadow-[inset_0_0_0_1px_var(--hairline-strong)] transition-colors duration-150 ease-out hover:bg-white/[0.06] hover:text-fg-1 active:bg-white/10"
    >
      <ArrowRight size={11} strokeWidth={1.75} aria-hidden className="text-fg-3" />
      <span className="font-mono text-[10px] tabular text-fg-3">{pad2(stage.index + 1)}</span>
      <span>{stage.title}</span>
    </button>
  );
}

function PendingTag({ control }: { control: keyof Controls }) {
  // Evolve re-runs Decoherence → Echo; the simulator only feeds Morphogenesis, which Evolve reuses.
  const text = control === "machine" ? "applies on next Create" : "applies on Evolve";
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-[10.5px] leading-none text-fg-3">
      <span aria-hidden className="size-[5px] shrink-0 rounded-full bg-fg-1" />
      {text}
    </span>
  );
}

function Param({ control, compact }: { control: keyof Controls; compact: boolean }) {
  const hintId = useId();
  const copy = PARAM_COPY[control];
  const pending = useChrono((s) => canEvolve(s.specimen) && isPending(control, s.controls, s.specimen?.controls));
  return (
    <div className={cx(compact ? "py-3.5" : "py-4", "first:pt-1")} data-param={control} data-pending={pending || undefined}>
      <ControlInput control={control} layoutId={`machine-panel${compact ? "-sheet" : ""}`} labelAside={pending && <PendingTag control={control} />} describedBy={hintId} />
      <p id={hintId} className="mt-1.5 text-[11px] leading-[1.45] text-fg-3">
        {copy.hint}
      </p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {copy.stages.map((id) => (
          <StageChip key={id} id={id} />
        ))}
      </div>
    </div>
  );
}

export function ParametersView({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex flex-col divide-y divide-hairline">
      {ORDER.map((k) => (
        <Param key={k} control={k} compact={compact} />
      ))}
    </div>
  );
}
