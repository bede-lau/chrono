"use client";
import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, CircleAlert, Info, RotateCcw, X } from "lucide-react";
import { ICON, T, cx } from "./primitives";
import { useUi, type Toast } from "./uiStore";

function ToastItem({ t }: { t: Toast }) {
  const dismiss = useUi((s) => s.dismissToast);
  useEffect(() => {
    if (!t.duration) return;
    const id = setTimeout(() => dismiss(t.id), t.duration);
    return () => clearTimeout(id);
  }, [t.id, t.duration, dismiss]);

  const Icon = t.kind === "error" ? CircleAlert : t.kind === "success" ? Check : Info;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={T}
      role={t.kind === "error" ? "alert" : "status"}
      className={cx(
        "pointer-events-auto flex max-w-[min(440px,calc(100vw-32px))] items-center gap-2.5 rounded-full glass-strong py-1.5 pr-1.5 pl-3.5 shadow-xl shadow-black/40",
        t.kind === "error" && "border-[color:var(--danger-soft)]",
      )}
    >
      <Icon {...ICON} size={15} className={cx("shrink-0", t.kind === "error" ? "text-danger" : "text-fg-2")} aria-hidden />
      <span className="min-w-0 py-1">
        <span className="block truncate text-[12.5px] text-fg-1">{t.title}</span>
        {t.detail && <span className="block truncate font-mono text-[10.5px] text-fg-3">{t.detail}</span>}
      </span>
      {t.action && (
        <button
          type="button"
          onClick={() => {
            dismiss(t.id);
            t.action!.run();
          }}
          className="ml-1 flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-white px-3 text-[12px] font-medium text-black transition-colors duration-200 hover:bg-white/85"
        >
          <RotateCcw size={12} strokeWidth={1.75} aria-hidden />
          {t.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismiss(t.id)}
        className="grid size-7 shrink-0 place-items-center rounded-full text-fg-3 transition-colors duration-200 hover:bg-white/[0.06] hover:text-fg-1"
      >
        <X {...ICON} size={14} />
      </button>
    </motion.li>
  );
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <ol aria-label="Notifications" className="pointer-events-none fixed inset-x-0 top-[calc(var(--safe-top)+64px)] z-[60] flex flex-col items-center gap-2 px-4 md:top-[calc(var(--safe-top)+18px)]">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastItem key={t.id} t={t} />
        ))}
      </AnimatePresence>
    </ol>
  );
}

/** Shutter flash for Capture. */
export function Flash() {
  const key = useUi((s) => s.flashKey);
  return (
    <AnimatePresence>
      {key > 0 && (
        <motion.div
          key={key}
          aria-hidden
          className="pointer-events-none fixed inset-0 z-[70] bg-white"
          initial={{ opacity: 0.22 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        />
      )}
    </AnimatePresence>
  );
}
