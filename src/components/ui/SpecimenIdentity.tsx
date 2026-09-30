"use client";
import { memo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useChrono } from "@/lib/store";
import { T } from "./primitives";

/** 256 genome bits as a hairline barcode: a set bit is a full-height line, a clear bit a short tick. */
export const GenomeBarcode = memo(function GenomeBarcode({ bytes, className }: { bytes: number[]; className?: string }) {
  const ones: string[] = [];
  const zeros: string[] = [];
  bytes.slice(0, 32).forEach((byte, i) => {
    for (let b = 0; b < 8; b++) {
      const x = i * 8 + b + 0.5;
      ((byte >> (7 - b)) & 1 ? ones : zeros).push(`M${x} 0V10`);
    }
  });
  return (
    <svg viewBox="0 0 256 10" width={256} height={10} preserveAspectRatio="none" shapeRendering="crispEdges" className={className} aria-hidden>
      <path d={zeros.join("")} stroke="white" strokeOpacity={0.14} strokeWidth={1} transform="translate(0 7) scale(1 0.3)" />
      <path d={ones.join("")} stroke="white" strokeOpacity={0.62} strokeWidth={1} />
    </svg>
  );
});

export function SpecimenIdentity({ compact = false }: { compact?: boolean }) {
  const name = useChrono((s) => s.specimen?.name);
  const generation = useChrono((s) => s.specimen?.generation);
  const genome = useChrono((s) => s.specimen?.genome);
  const mode = useChrono((s) => s.mode);
  const hex = genome?.hex;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={name ?? "none"}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={T}
          className="flex items-baseline gap-2 whitespace-nowrap"
        >
          <span className="text-[12.5px] font-medium tracking-[-0.005em] text-fg-1">{name ?? "New specimen"}</span>
          {generation != null && (
            <span className="font-mono text-[11px] tabular text-fg-3">
              {compact ? "G" : "Gen "}
              {generation}
            </span>
          )}
          {mode === "growing" && <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-3">Growing</span>}
        </motion.div>
      </AnimatePresence>
      {!compact && (
        <div className="h-2.5" title={hex ? `Genome ${hex}` : undefined}>
          <AnimatePresence mode="wait" initial={false}>
            {genome?.bytes && genome.bytes.length >= 32 && (
              <motion.div key={hex} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={T} role="img" aria-label={`Genome, 256 bits: ${hex}`}>
                <GenomeBarcode bytes={genome.bytes} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
