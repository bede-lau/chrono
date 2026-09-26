"use client";
import { useEffect, useSyncExternalStore } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { SlidersHorizontal } from "lucide-react";
import { STAGES, type StageId, type Wound } from "@/lib/chain/types";
import { useChrono } from "@/lib/store";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useShortcuts } from "@/hooks/useShortcuts";
import { useSpecimenHue } from "@/hooks/useSpecimenHue";
import { bootstrap, evolve, isBusy, newSpecimen, toggleAudio } from "./actions";
import { ArchiveDrawer } from "./ArchiveDrawer";
import { ChainRail } from "./ChainRail";
import { ChainActions, ControlsBody, ControlsCard } from "./ControlsCard";
import { Organism, useAudioEngine } from "./deps";
import { Hint } from "./Hint";
import { InfoSheet } from "./InfoSheet";
import { Inspector } from "./Inspector";
import { Panel, PanelClose } from "./Panel";
import { ICON, T, T_SLOW } from "./primitives";
import { Telemetry } from "./Telemetry";
import { Flash, Toasts } from "./Toasts";
import { TopBar } from "./TopBar";
import { useUi } from "./uiStore";

const subscribeNoop = () => () => {};
const useMounted = () => useSyncExternalStore(subscribeNoop, () => true, () => false);

/** Only one side surface at a time: inspector, archive and the mobile controls sheet displace each other. */
function usePanelExclusivity() {
  useEffect(() => {
    const a = useChrono.subscribe((s, prev) => {
      if (s.selectedStage && !prev.selectedStage) {
        const p = useUi.getState().panel;
        if (p === "archive" || p === "controls") useUi.getState().openPanel(null);
      }
    });
    const b = useUi.subscribe((s, prev) => {
      if (s.panel !== prev.panel && (s.panel === "archive" || s.panel === "controls")) useChrono.getState().selectStage(null);
    });
    return () => {
      a();
      b();
    };
  }, []);
}

function EmptyState() {
  const booted = useUi((s) => s.booted);
  const show = useChrono((s) => !s.specimen && s.mode === "idle");
  return (
    <AnimatePresence>
      {booted && show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={T_SLOW}
          className="pointer-events-auto absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-4"
        >
          <span className="label">No specimen</span>
          <button
            type="button"
            data-accent-focus
            onClick={newSpecimen}
            className="h-10 rounded-full bg-[#f4f4f5] px-5 text-[13px] font-medium text-black transition-colors duration-200 hover:bg-white"
          >
            Grow a specimen
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function MobileBar() {
  const togglePanel = useUi((s) => s.togglePanel);
  const open = useUi((s) => s.panel === "controls");
  return (
    <div className="pointer-events-auto flex items-center gap-2 px-4 pt-2">
      <button
        type="button"
        aria-label="Controls"
        aria-expanded={open}
        onClick={() => togglePanel("controls")}
        className="grid size-10 shrink-0 place-items-center rounded-[11px] glass text-fg-2 transition-colors duration-200 active:bg-white/10"
      >
        <SlidersHorizontal {...ICON} />
      </button>
      <div className="min-w-0 flex-1">
        <ChainActions layout="row" />
      </div>
    </div>
  );
}

function ControlsSheet() {
  const open = useUi((s) => s.panel === "controls");
  const openPanel = useUi((s) => s.openPanel);
  const close = () => openPanel(null);
  return (
    <Panel open={open} onClose={close} label="Controls" mobile>
      <header className="flex items-center justify-between px-5 pt-3 pb-2">
        <h2 className="label">Mutation</h2>
        <div className="-mr-1.5">
          <PanelClose onClose={close} />
        </div>
      </header>
      <div className="px-5 pb-5">
        <ControlsBody layoutId="machine-sheet" />
      </div>
    </Panel>
  );
}

export function ChronoApp() {
  const mounted = useMounted();
  const mobile = useIsMobile();
  const inspectorOpen = useChrono((s) => !!s.selectedStage);
  const panel = useUi((s) => s.panel);
  const { click } = useAudioEngine();

  useSpecimenHue();
  usePanelExclusivity();

  useEffect(() => {
    void bootstrap();
    // Dev-only handle for poking the stores from the console / test scripts.
    if (process.env.NODE_ENV !== "production") Object.assign(window, { __chrono: useChrono, __chronoUi: useUi });
  }, []);

  useShortcuts({
    evolve: () => {
      if (!isBusy()) evolve();
    },
    newSpecimen: () => {
      if (!isBusy()) newSpecimen();
    },
    toggleMute: toggleAudio,
    inspect: (i) => {
      const id = STAGES[i]?.id as StageId | undefined;
      if (!id) return;
      const st = useChrono.getState();
      st.selectStage(st.selectedStage === id ? null : id);
    },
    step: (d) => {
      const st = useChrono.getState();
      const cur = STAGES.find((s) => s.id === st.selectedStage);
      if (cur) st.selectStage(STAGES[(cur.index + d + STAGES.length) % STAGES.length].id);
    },
    escape: () => {
      const ui = useUi.getState();
      const st = useChrono.getState();
      if (ui.panel === "info") ui.openPanel(null);
      else if (st.selectedStage) st.selectStage(null);
      else if (ui.panel) ui.openPanel(null);
      else if (ui.logOpen) ui.setLogOpen(false);
    },
  });

  const showCard = !inspectorOpen && panel !== "archive";

  return (
    <MotionConfig reducedMotion="user" transition={T}>
      <main className="fixed inset-0 overflow-hidden bg-stage">
        {/* The organism is the stage. Everything else floats above it and lets pointer events through. */}
        <div className="absolute inset-0 z-0">
          <Organism onWound={(w: Wound) => click(w.strength)} />
        </div>
        <div aria-hidden className="vignette pointer-events-none absolute inset-0 z-[1]" />

        {mounted && (
          <motion.div
            className="pointer-events-none absolute inset-0 z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            <Hint compact={mobile} />
            <EmptyState />
            <TopBar compact={mobile} />

            {!mobile && (
              <>
                <div className="absolute top-1/2 right-5 -translate-y-1/2">
                  <AnimatePresence>
                    {showCard && (
                      <motion.div key="card" exit={{ opacity: 0, x: 8 }} transition={T}>
                        <ControlsCard />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <div className="absolute bottom-[var(--rail-clearance)] left-6">
                  <Telemetry />
                </div>
              </>
            )}

            <div className="absolute inset-x-0 bottom-0 pb-[calc(var(--safe-bottom)+16px)]">
              {mobile ? (
                <>
                  <ChainRail compact />
                  <MobileBar />
                </>
              ) : (
                <div className="mx-auto max-w-[1080px] px-6">
                  <ChainRail />
                </div>
              )}
            </div>

            <Inspector mobile={mobile} />
            <ArchiveDrawer mobile={mobile} />
            {mobile && <ControlsSheet />}
            <InfoSheet />
            <Toasts />
          </motion.div>
        )}
        <Flash />
      </main>
    </MotionConfig>
  );
}
