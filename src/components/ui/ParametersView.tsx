"use client";
/**
 * Parameters view of the right panel: the four mutation controls, each with its plain-English hint and links to
 * the engine(s) it steers. All copy comes from PARAM_COPY.
 */
import { useId, useState, useSyncExternalStore, type MouseEvent } from "react";
import { ArrowRight, Eye, EyeOff, X } from "lucide-react";
import { PARAM_COPY } from "@/lib/chain/stageCopy";
import { STAGES, type Controls, type StageId } from "@/lib/chain/types";
import { checkMothKey, clearMothKey, getMothKeyState, getServerMothKeyState, setMothKey, subscribeMothKey } from "@/lib/moth/sessionKey";
import { useChrono } from "@/lib/store";
import { canEvolve, openStage } from "./actions";
import { ControlInput, isPending } from "./ControlsCard";
import { pad2 } from "./format";
import { cx } from "./primitives";
import { useUi } from "./uiStore";

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
    <div className="flex flex-col">
      <div className="flex flex-col divide-y divide-hairline">
        {ORDER.map((k) => (
          <Param key={k} control={k} compact={compact} />
        ))}
      </div>
      <ByokKeyField compact={compact} />
    </div>
  );
}

function ByokKeyField({ compact }: { compact: boolean }) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  const hintId = useId();
  const keyState = useSyncExternalStore(subscribeMothKey, getMothKeyState, getServerMothKeyState);
  const mode = useChrono((s) => s.mode);
  const running = useUi((s) => s.running);
  const locked = mode !== "idle" || running !== null;
  const checking = keyState.status === "checking";
  const statusText = locked
    ? "Key changes are paused while Create or Evolve runs."
    : keyState.status === "empty"
      ? "Using app key"
      : keyState.status === "unverified"
        ? "Check this key before using it."
        : keyState.status === "accepted"
          ? "Accepted · Used for Create and Evolve"
          : keyState.status === "checking"
            ? "Checking key…"
            : keyState.message ?? "Key check unavailable. Try again.";
  const statusTone = keyState.status === "accepted" ? "text-emerald-200/75" : keyState.status === "rejected" ? "text-rose-200/75" : "text-fg-3";

  return (
    <section className={cx("border-t border-hairline", compact ? "pt-4 pb-2" : "pt-5 pb-2")} aria-labelledby={`${id}-title`}>
      <div className="mb-2.5">
        <label id={`${id}-title`} htmlFor={id} className="text-[11px] font-medium tracking-[0.08em] text-fg-2">
          MOTH API KEY
        </label>
      </div>
      <div className="flex h-10 min-w-0 items-center rounded-[7px] border border-white/[0.12] bg-white/[0.025] transition-colors focus-within:border-white/25">
        <input
          id={id}
          value={keyState.value}
          onChange={(event) => setMothKey(event.currentTarget.value)}
          type={visible ? "text" : "password"}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          disabled={locked}
          aria-invalid={keyState.status === "rejected" || undefined}
          aria-describedby={hintId}
          placeholder="moth_…"
          className="h-full min-w-0 flex-1 bg-transparent px-3 font-mono text-[12px] text-fg-1 placeholder:text-white/20 focus:outline-none disabled:opacity-45"
        />
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          aria-label={visible ? "Hide Moth API key" : "Show Moth API key"}
          aria-pressed={visible}
          className="grid size-9 shrink-0 place-items-center rounded-md text-fg-3 transition-colors hover:text-fg-1 focus-visible:text-fg-1"
        >
          {visible ? <EyeOff size={14} strokeWidth={1.6} aria-hidden /> : <Eye size={14} strokeWidth={1.6} aria-hidden />}
        </button>
        <button
          type="button"
          onClick={clearMothKey}
          aria-label="Clear Moth API key"
          disabled={locked || keyState.status === "empty"}
          className="mr-1 grid size-8 shrink-0 place-items-center rounded-md text-fg-3 transition-colors hover:text-fg-1 focus-visible:text-fg-1 disabled:cursor-default disabled:opacity-35"
        >
          <X size={13} strokeWidth={1.6} aria-hidden />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p id={hintId} role="status" aria-live="polite" className={cx("min-w-0 flex-1 text-[11px] leading-[1.45]", statusTone)}>
          {statusText}
        </p>
        <button
          type="button"
          onClick={() => void checkMothKey()}
          disabled={locked || checking || keyState.status === "empty"}
          className="inline-flex h-7 shrink-0 items-center rounded-md px-2 text-[11px] font-medium text-fg-2 shadow-[inset_0_0_0_1px_var(--hairline-strong)] transition-colors hover:bg-white/[0.06] hover:text-fg-1 disabled:cursor-default disabled:opacity-35"
        >
          {checking ? "Checking…" : "Check key"}
        </button>
      </div>
    </section>
  );
}
