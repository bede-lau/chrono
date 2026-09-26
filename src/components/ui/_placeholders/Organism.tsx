"use client";
/**
 * TEMPORARY stand-in for src/components/organism/Organism.tsx (viewport agent).
 * A soft 2D orb textured with the specimen's skin; clicking paints a wound into the store.
 */
import { useRef } from "react";
import { useChrono } from "@/lib/store";
import type { Wound } from "@/lib/chain/types";

export default function PlaceholderOrganism({ onWound }: { onWound?: (w: Wound) => void }) {
  const specimen = useChrono((s) => s.specimen);
  const wounds = useChrono((s) => s.pendingWounds);
  const addWound = useChrono((s) => s.addWound);
  const level = useChrono((s) => s.audioLevel);
  const ref = useRef<HTMLDivElement>(null);
  const tex = specimen?.tissue?.url ?? specimen?.skin?.url ?? specimen?.colony?.seed.url;

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-stage">
      <div
        ref={ref}
        role="img"
        aria-label="Organism"
        onPointerDown={(e) => {
          const r = ref.current!.getBoundingClientRect();
          const w: Wound = { u: (e.clientX - r.left) / r.width, v: (e.clientY - r.top) / r.height, strength: 0.8, t: Date.now() };
          addWound(w);
          onWound?.(w);
        }}
        className="relative aspect-square w-[min(58vw,58vh)] rounded-full"
        style={{
          transform: `scale(${1 + level * 0.04})`,
          transition: "transform 200ms ease-out",
          boxShadow: "0 0 120px 10px hsl(var(--specimen-hue) 70% 50% / 0.18), inset 0 0 80px rgb(0 0 0 / 0.7)",
          background: tex
            ? `radial-gradient(circle at 35% 30%, rgb(255 255 255 / 0.18), transparent 45%), radial-gradient(circle, transparent 55%, rgb(0 0 0 / 0.75) 100%), url(${tex}) center / 200% 100%`
            : "radial-gradient(circle, rgb(255 255 255 / 0.06), transparent 70%)",
          filter: "blur(0.5px) saturate(1.1)",
        }}
      >
        {wounds.map((w) => (
          <span
            key={w.t}
            className="pointer-events-none absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: `${w.u * 100}%`, top: `${w.v * 100}%`, background: "radial-gradient(circle, rgb(0 0 0 / 0.7), transparent 70%)" }}
          />
        ))}
      </div>
    </div>
  );
}
