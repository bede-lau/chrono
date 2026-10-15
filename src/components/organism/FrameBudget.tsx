"use client";
import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { useChrono } from "@/lib/store";

/** A single bounded render clock. OrbitControls' invalidations cannot start a second loop. */
export function FrameBudget() {
  const advance = useThree((s) => s.advance);
  const get = useThree((s) => s.get);
  useEffect(() => {
    let timer = 0;
    let raf = 0;
    let last = performance.now();
    let time = get().clock.elapsedTime;
    let stopped = false;
    const cancel = () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
    const frame = () => {
      if (stopped || document.hidden) return;
      const start = performance.now();
      time += Math.min((start - last) / 1000, 0.1);
      last = start;
      advance(time, false);
      const interval = 1000 / (useChrono.getState().specimen ? 30 : 15);
      timer = window.setTimeout(() => {
        raf = requestAnimationFrame(frame);
      }, Math.max(0, interval - (performance.now() - start) - 2));
    };
    const visibility = () => {
      cancel();
      last = performance.now();
      if (!document.hidden) raf = requestAnimationFrame(frame);
      else useChrono.getState().setFps(0);
    };
    document.addEventListener("visibilitychange", visibility);
    visibility();
    return () => {
      stopped = true;
      cancel();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [advance, get]);
  return null;
}
