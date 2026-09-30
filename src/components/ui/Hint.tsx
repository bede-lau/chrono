"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useChrono } from "@/lib/store";
import { canEvolve } from "./actions";
import { T_SLOW, cx } from "./primitives";

const KEY = "chrono.hint.decohere";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed() {
  try {
    window.localStorage.setItem(KEY, "1");
  } catch {
    /* storage unavailable (private mode) — the hint simply returns next visit */
  }
}

/**
 * First-run hint near the organism. Only once there is a specimen a touch can wound (a finished Create or an
 * archived one) and nothing is running. Gone for good after the first wound.
 */
export function Hint({ compact = false }: { compact?: boolean }) {
  const hasSpecimen = useChrono((s) => canEvolve(s.specimen) && s.mode === "idle");
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!hasSpecimen || readDismissed()) return;
    const t = setTimeout(() => setShow(!readDismissed() && useChrono.getState().pendingWounds.length === 0), 1400);
    const unsub = useChrono.subscribe((s, prev) => {
      if (s.pendingWounds.length > prev.pendingWounds.length) {
        clearTimeout(t);
        writeDismissed();
        setShow(false);
      }
    });
    return () => {
      clearTimeout(t);
      unsub();
    };
  }, [hasSpecimen]);

  return (
    <AnimatePresence>
      {show && hasSpecimen && (
        <motion.div
          key="hint"
          role="status"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4, transition: { duration: 0.3 } }}
          transition={{ ...T_SLOW, duration: 0.8 }}
          className={cx(
            "pointer-events-none absolute left-1/2 z-10 flex -translate-x-1/2 items-center gap-2.5 whitespace-nowrap",
            compact ? "bottom-[calc(var(--safe-bottom)+176px)]" : "bottom-[calc(var(--rail-clearance)+12px)]",
          )}
        >
          <span aria-hidden className="relative grid size-3 place-items-center">
            <span className="breathe absolute inset-0 rounded-full border border-white/40" />
            <span className="size-1 rounded-full bg-white/80" />
          </span>
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-fg-2">Touch to decohere</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
