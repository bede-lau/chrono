"use client";
import { useRef, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { ICON, IconButton, T, cx } from "./primitives";

/** Desktop: floating right slide-over between the top bar and the rail. Mobile: bottom sheet with scrim. */
export function Panel({
  open,
  onClose,
  label,
  mobile,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  mobile: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <AnimatePresence>
      {open && (
        <PanelInner key="panel" onClose={onClose} label={label} mobile={mobile} className={className}>
          {children}
        </PanelInner>
      )}
    </AnimatePresence>
  );
}

function PanelInner({ onClose, label, mobile, children, className }: { onClose: () => void; label: string; mobile: boolean; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  useFocusTrap(ref, true);

  return (
    <>
      {mobile && (
        <motion.div
          aria-hidden
          className="pointer-events-auto fixed inset-0 z-30 bg-black/45"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={T}
          onClick={onClose}
        />
      )}
      <motion.aside
        ref={ref}
        role="dialog"
        aria-modal={mobile ? "true" : "false"}
        aria-label={label}
        tabIndex={-1}
        initial={mobile ? { y: "100%" } : { opacity: 0, x: 16 }}
        animate={mobile ? { y: 0 } : { opacity: 1, x: 0 }}
        exit={mobile ? { y: "100%" } : { opacity: 0, x: 16 }}
        transition={T}
        className={cx(
          "pointer-events-auto fixed z-40 flex flex-col overflow-hidden glass-strong shadow-2xl shadow-black/60",
          mobile
            ? "inset-x-0 bottom-0 max-h-[84dvh] rounded-t-[22px] border-b-0 pb-[var(--safe-bottom)]"
            : "top-[72px] right-5 bottom-[var(--rail-clearance)] w-[380px] rounded-[18px]",
          className,
        )}
      >
        {mobile && <span aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-white/20" />}
        {children}
      </motion.aside>
    </>
  );
}

export function PanelClose({ onClose }: { onClose: () => void }) {
  return (
    <IconButton label="Close" kbd="Esc" onClick={onClose} size="sm" tipAlign="end">
      <X {...ICON} />
    </IconButton>
  );
}
