"use client";
import { useEffect, useSyncExternalStore } from "react";
import { MotionConfig, motion } from "motion/react";
import { SlidersHorizontal } from "lucide-react";
import { LENS_OFF, STAGES, type Wound } from "@/lib/chain/types";
import { useChrono } from "@/lib/store";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useShortcuts } from "@/hooks/useShortcuts";
import { useSpecimenHue } from "@/hooks/useSpecimenHue";
import { bootstrap, newSpecimen, openParameters, openStage, primary, stepStage, toggleAudio, watchRuns } from "./actions";
import { ArchiveDrawer } from "./ArchiveDrawer";
import { ChainRail } from "./ChainRail";
import { ChainActions } from "./ControlsCard";
import { Organism, useAudioEngine } from "./deps";
import { Hint } from "./Hint";
import { InfoSheet } from "./InfoSheet";
import { ICON, T } from "./primitives";
import { RightPanel } from "./RightPanel";
import { Telemetry } from "./Telemetry";
import { Flash, Toasts } from "./Toasts";
import { TopBar } from "./TopBar";
import { selectEvolutionVisible, useUi } from "./uiStore";

const subscribeNoop = () => () => {};
const useMounted = () => useSyncExternalStore(subscribeNoop, () => true, () => false);

/** Shortcuts can replace the focused control; give keyboard users a stable landing point in the new view. */
const focusPanelView = () => requestAnimationFrame(() => document.getElementById("chrono-panel-view")?.focus({ preventScroll: true }));

function MobileBar() {
  const openPanel = useUi((s) => s.openPanel);
  const open = useUi((s) => s.panel === "sheet");
  return (
    <div className="pointer-events-auto mx-auto flex max-w-[560px] items-center gap-2 px-4 pt-2">
      <button
        type="button"
        aria-label="Parameters and evolution"
        aria-expanded={open}
        onClick={() => openPanel(open ? null : "sheet")}
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

export function ChronoApp() {
  const mounted = useMounted();
  const mobile = useIsMobile();
  const { click } = useAudioEngine();

  useSpecimenHue();

  useEffect(() => {
    useUi.getState().setMobile(mobile);
  }, [mobile]);

  useEffect(() => {
    void bootstrap();
    const unwatch = watchRuns();
    // The lens and linked probe belong to the Evolution view; clear both as soon as it leaves the screen.
    const unlens = useUi.subscribe((s, prev) => {
      if (selectEvolutionVisible(prev) && !selectEvolutionVisible(s)) {
        useChrono.getState().setLens(LENS_OFF);
        useChrono.getState().setProbe(null);
      }
    });
    // Dev-only handle for poking the stores from the console / test scripts.
    if (process.env.NODE_ENV !== "production") Object.assign(window, { __chrono: useChrono, __chronoUi: useUi });
    return () => {
      unwatch();
      unlens();
    };
  }, []);

  useShortcuts({
    primary,
    newSpecimen,
    toggleMute: toggleAudio,
    inspect: (i) => {
      const id = STAGES[i]?.id;
      if (id) {
        openStage(id);
        focusPanelView();
      }
    },
    parameters: () => {
      openParameters();
      focusPanelView();
    },
    step: (d) => {
      if (selectEvolutionVisible(useUi.getState())) stepStage(d);
    },
    escape: () => {
      const ui = useUi.getState();
      if (ui.panel === "info" || ui.panel === "archive") ui.openPanel(null);
      else if (ui.tab === "evolution") {
        openParameters(false);
        focusPanelView();
      }
      else if (ui.panel === "sheet") ui.openPanel(null);
      else if (ui.logOpen) ui.setLogOpen(false);
    },
  });

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
            <TopBar compact={mobile} />

            {/* Reading / Tab order follows the layout: top bar, the panel, then telemetry and the rail. */}
            {!mobile && (
              <>
                <RightPanel mobile={false} />
                <div className="absolute bottom-[var(--rail-clearance)] left-6">
                  <Telemetry />
                </div>
              </>
            )}

            <div className="absolute inset-x-0 bottom-0 pr-[var(--safe-right)] pb-[calc(var(--safe-bottom)+16px)] pl-[var(--safe-left)]">
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

            {mobile && <RightPanel mobile />}
            <ArchiveDrawer mobile={mobile} />
            <InfoSheet />
            <Toasts />
          </motion.div>
        )}
        <Flash />
      </main>
    </MotionConfig>
  );
}
