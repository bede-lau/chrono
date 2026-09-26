"use client";
/**
 * <Organism /> — the living 3D specimen. Fills its parent, reads `useChrono`.
 * OWNER: viewport agent.
 *
 *   import Organism from "@/components/organism/Organism";
 *   <Organism onWound={(w) => audio.click(w.strength)} />
 *
 * Capture: `import { captureOrganismPng } from "@/components/organism/capture"`.
 */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, type CSSProperties } from "react";
import type { Wound } from "@/lib/chain/types";
import type { CursorApi } from "./OrganismScene";

export interface OrganismProps {
  /** Fired on every touch (click/tap without drag) after the wound is added to the store. */
  onWound?: (w: Wound) => void;
  /** Disable orbit/touch (e.g. for thumbnails). Default true. */
  interactive?: boolean;
  /** Slow idle auto-rotation (pauses on interaction, resumes after 4 s). Default true. */
  autoRotate?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** CSS twin of the GL stage so there is never an empty frame while WebGL boots. */
export const STAGE_BACKGROUND = "radial-gradient(120% 120% at 50% 50%, #0b0b0e 0%, #070708 45%, #050506 70%, #030304 100%)";

const OrganismScene = dynamic(() => import("./OrganismScene"), { ssr: false, loading: () => null });

export default function Organism({ onWound, interactive = true, autoRotate = true, className, style }: OrganismProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const ringInnerRef = useRef<HTMLDivElement>(null);
  const onWoundRef = useRef<((w: Wound) => void) | undefined>(onWound);
  useEffect(() => {
    onWoundRef.current = onWound;
  }, [onWound]);
  const state = useRef({ hovering: false, dragging: false });

  const applyCursor = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const { hovering, dragging } = state.current;
    root.style.cursor = dragging ? "grabbing" : hovering ? "none" : "grab";
    if (ringRef.current) ringRef.current.style.opacity = hovering ? "1" : "0";
  }, []);

  const cursor = useMemo<CursorApi>(
    () => ({
      hover(active, clientX, clientY) {
        state.current.hovering = active;
        const root = rootRef.current;
        const ring = ringRef.current;
        if (active && root && ring && clientX !== undefined && clientY !== undefined) {
          const r = root.getBoundingClientRect();
          ring.style.transform = `translate3d(${clientX - r.left}px, ${clientY - r.top}px, 0)`;
        }
        applyCursor();
      },
      dragging(active) {
        state.current.dragging = active;
        applyCursor();
      },
      pulse() {
        const el = ringInnerRef.current;
        if (!el || typeof el.animate !== "function") return;
        el.animate(
          [
            { transform: "scale(0.55)", opacity: 1, borderColor: "rgba(255,255,255,0.95)" },
            { transform: "scale(1.9)", opacity: 0, borderColor: "rgba(255,255,255,0.2)" },
          ],
          { duration: 520, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        );
      },
    }),
    [applyCursor],
  );

  return (
    <div
      ref={rootRef}
      className={className}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: STAGE_BACKGROUND,
        touchAction: "none",
        userSelect: "none",
        cursor: interactive ? "grab" : "default",
        ...style,
      }}
    >
      <OrganismScene onWoundRef={onWoundRef} cursor={cursor} interactive={interactive} autoRotate={autoRotate} />
      <div
        ref={ringRef}
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          pointerEvents: "none",
          opacity: 0,
          transition: "opacity 160ms ease-out",
          willChange: "transform",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: -13,
            top: -13,
            width: 26,
            height: 26,
            borderRadius: "50%",
            border: "1px solid rgba(255,255,255,0.55)",
            boxShadow: "0 0 10px rgba(255,255,255,0.08), inset 0 0 6px rgba(255,255,255,0.05)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: -1.5,
            top: -1.5,
            width: 3,
            height: 3,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.7)",
          }}
        />
        <div
          ref={ringInnerRef}
          style={{
            position: "absolute",
            left: -13,
            top: -13,
            width: 26,
            height: 26,
            borderRadius: "50%",
            border: "1px solid rgba(255,255,255,0)",
            opacity: 0,
          }}
        />
      </div>
    </div>
  );
}
