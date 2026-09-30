"use client";
/**
 * The right panel: one surface, two views — Parameters | Evolution — with the primary action in its footer.
 * Desktop: fixed on the right between the top bar and the rail. Mobile: the same content in a bottom sheet.
 *
 * Switching is immediate: the view swaps in the same frame (a short fade-in, never an exit animation to wait on).
 * The stage shown in Evolution is `useChrono.selectedStage` (follow mode keeps it on the running stage).
 */
import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { STAGES, type StageId } from "@/lib/chain/types";
import { useChrono, type ChronoState } from "@/lib/store";
import { openEvolution, openParameters, pinStage, stepStage } from "./actions";
import { ChainActions } from "./ControlsCard";
import { EvolutionView } from "./EvolutionView";
import { pad2 } from "./format";
import { Panel, PanelClose } from "./Panel";
import { ParametersView } from "./ParametersView";
import { EASE_OUT, ICON, IconButton, T, cx } from "./primitives";
import { useUi, type Tab } from "./uiStore";

const TABS: { id: Tab; label: string }[] = [
  { id: "parameters", label: "Parameters" },
  { id: "evolution", label: "Evolution" },
];

const T_SWITCH = { duration: 0.15, ease: EASE_OUT };

/** Stage the Evolution view shows (same rule as actions.viewStage, as a selector). */
const selectViewStage = (s: ChronoState): StageId => s.selectedStage ?? s.activeStage ?? STAGES[0].id;

/* ---------------------------------------------------------------- header */

function Tabs({ layoutId }: { layoutId: string }) {
  const tab = useUi((s) => s.tab);
  const select = (t: Tab) => (t === "parameters" ? openParameters(false) : openEvolution(false));
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    let j = -1;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") j = (i + (e.key === "ArrowLeft" ? -1 : 1) + TABS.length) % TABS.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = TABS.length - 1;
    if (j < 0) return;
    e.preventDefault();
    select(TABS[j].id);
    e.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-tab="${TABS[j].id}"]`)?.focus();
  };
  return (
    <div role="tablist" aria-label="Panel view" className="relative grid shrink-0 grid-cols-2 rounded-[10px] bg-white/[0.045] p-[3px]">
      {TABS.map((t, i) => {
        const on = tab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`chrono-tab-${t.id}`}
            data-tab={t.id}
            aria-selected={on}
            aria-controls="chrono-panel-view"
            aria-keyshortcuts={t.id === "parameters" ? "P" : undefined}
            tabIndex={on ? 0 : -1}
            onClick={() => select(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cx(
              "relative h-7 rounded-[8px] px-3 text-[12px] font-medium transition-colors duration-150 ease-out",
              on ? "text-fg-1" : "text-fg-3 hover:text-fg-2",
            )}
          >
            {on && (
              <motion.span
                layoutId={layoutId}
                transition={T_SWITCH}
                className="absolute inset-0 rounded-[8px] bg-white/[0.11] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]"
              />
            )}
            <span className="relative">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Stepper() {
  const stage = useChrono(selectViewStage);
  const i = STAGES.findIndex((s) => s.id === stage);
  return (
    <div role="group" aria-label="Engine" className="flex items-center">
      <IconButton label="Previous engine" kbd="←" size="sm" onClick={() => stepStage(-1)} disabled={i <= 0}>
        <ChevronLeft {...ICON} />
      </IconButton>
      <span className="min-w-[46px] text-center font-mono text-[11px] tabular text-fg-1">
        {pad2(i + 1)}
        <span className="text-fg-3"> / {pad2(STAGES.length)}</span>
      </span>
      <IconButton label="Next engine" kbd="→" size="sm" tipAlign="end" onClick={() => stepStage(1)} disabled={i >= STAGES.length - 1}>
        <ChevronRight {...ICON} />
      </IconButton>
    </div>
  );
}

/** Horizontal gutter shared with EvolutionView (which brings its own): 20 px, 16 px in the compact sheet. */
const gutterX = (compact: boolean) => (compact ? "px-4" : "px-5");

function PanelHeader({ onClose, layoutId, compact }: { onClose?: () => void; layoutId: string; compact: boolean }) {
  const tab = useUi((s) => s.tab);
  return (
    <header className={cx("flex h-[52px] shrink-0 items-center gap-2 pr-3", compact ? "pl-4" : "pl-5")}>
      <Tabs layoutId={layoutId} />
      <div className="ml-auto flex items-center">
        {tab === "evolution" && (
          <motion.div key="stepper" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={T_SWITCH}>
            <Stepper />
          </motion.div>
        )}
        {onClose && <PanelClose onClose={onClose} />}
      </div>
    </header>
  );
}

/* ---------------------------------------------------------------- body + footer */

function PanelBody({ compact }: { compact: boolean }) {
  const tab = useUi((s) => s.tab);
  const follow = useUi((s) => s.follow);
  const running = useChrono((s) => s.mode !== "idle");
  const stage = useChrono(selectViewStage);
  const scroller = useRef<HTMLDivElement>(null);
  const view = tab === "parameters" ? "parameters" : `evolution:${stage}`;

  // A new view starts at its top.
  useLayoutEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [view]);

  return (
    <div ref={scroller} className="thin-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-hairline">
      <div
        key={view}
        id="chrono-panel-view"
        role="tabpanel"
        aria-labelledby={`chrono-tab-${tab}`}
        tabIndex={-1}
        data-view={view}
        // EvolutionView is mounted edge to edge (its own gutters + full-bleed hairlines); Parameters gets ours.
        className={cx("view-in pb-6", tab === "parameters" && [gutterX(compact), compact ? "pt-3" : "pt-4"].join(" "))}
      >
        {tab === "parameters" ? (
          <ParametersView compact={compact} />
        ) : (
          <EvolutionView stage={stage} compact={compact} following={follow && running} onPin={pinStage} />
        )}
      </div>
    </div>
  );
}

function PanelFooter({ compact }: { compact: boolean }) {
  return (
    <footer className={cx("shrink-0 border-t border-hairline pt-4", gutterX(compact), compact ? "pb-4" : "pb-5")}>
      <ChainActions />
    </footer>
  );
}

/* ---------------------------------------------------------------- shells */

function DesktopPanel() {
  const covered = useUi((s) => s.panel === "archive");
  return (
    <AnimatePresence>
      {!covered && (
        <motion.section
          key="right-panel"
          aria-label="Specimen panel"
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 12 }}
          transition={T}
          className="pointer-events-auto fixed top-[72px] right-6 bottom-[var(--rail-clearance)] z-20 flex w-[344px] flex-col overflow-hidden rounded-[18px] glass-panel shadow-2xl shadow-black/40"
        >
          <PanelHeader layoutId="panel-tab" compact={false} />
          <PanelBody compact={false} />
          <PanelFooter compact={false} />
        </motion.section>
      )}
    </AnimatePresence>
  );
}

function MobileSheet() {
  const open = useUi((s) => s.panel === "sheet");
  const close = () => useUi.getState().openPanel(null);
  return (
    <Panel open={open} onClose={close} label="Specimen panel" mobile className="h-[min(78dvh,700px)]">
      <PanelHeader layoutId="sheet-tab" onClose={close} compact />
      <PanelBody compact />
      <PanelFooter compact />
    </Panel>
  );
}

export function RightPanel({ mobile }: { mobile: boolean }) {
  return mobile ? <MobileSheet /> : <DesktopPanel />;
}
