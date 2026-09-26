"use client";
import { useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { STAGES } from "@/lib/chain/types";
import { useChrono } from "@/lib/store";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { pad2 } from "./format";
import { PanelClose } from "./Panel";
import { Kbd, T } from "./primitives";
import { useUi } from "./uiStore";

const KEYS: [string, string][] = [
  ["Space", "Evolve"],
  ["N", "New"],
  ["M", "Mute"],
  ["1–8", "Inspect"],
  ["Esc", "Close"],
];

function Sheet({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const selectStage = useChrono((s) => s.selectStage);
  useFocusTrap(ref, true);

  return (
    <motion.div
      className="pointer-events-auto fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={T}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="info-title"
        tabIndex={-1}
        initial={{ opacity: 0, y: 8, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.985 }}
        transition={T}
        className="w-full max-w-[400px] rounded-[20px] glass-strong shadow-2xl shadow-black/60"
      >
        <header className="flex items-start justify-between gap-4 px-6 pt-6">
          <div>
            <h2 id="info-title" className="text-[20px] font-semibold tracking-[-0.02em] text-fg-1">
              Chrono
            </h2>
            <p className="mt-1.5 text-[13px] leading-snug text-fg-2">A quantum organism whose whole life is computed by eight Moth Atlas engines.</p>
          </div>
          <div className="-mt-1 -mr-2">
            <PanelClose onClose={onClose} />
          </div>
        </header>

        <ol aria-label="The daisy chain" className="mt-5 px-3">
          {STAGES.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  selectStage(s.id);
                }}
                className="grid h-9 w-full grid-cols-[24px_1fr_auto] items-center gap-2 rounded-[9px] px-3 text-left transition-colors duration-200 hover:bg-white/[0.05]"
              >
                <span className="font-mono text-[10.5px] tabular text-fg-3">{pad2(s.index + 1)}</span>
                <span className="text-[13px] text-fg-1">{s.title}</span>
                <span className="text-[12px] text-fg-3">{s.engineName}</span>
              </button>
            </li>
          ))}
        </ol>

        <footer className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-hairline px-6 py-4">
          {KEYS.map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1.5 text-[11.5px] text-fg-3">
              <Kbd>{k}</Kbd>
              {v}
            </span>
          ))}
        </footer>
      </motion.div>
    </motion.div>
  );
}

export function InfoSheet() {
  const open = useUi((s) => s.panel === "info");
  const openPanel = useUi((s) => s.openPanel);
  return <AnimatePresence>{open && <Sheet key="info" onClose={() => openPanel(null)} />}</AnimatePresence>;
}
