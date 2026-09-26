"use client";
import { useEffect, useState } from "react";
import { useChrono } from "@/lib/store";

/**
 * Frames per second: the viewport's own measurement from the store when it reports one, otherwise a
 * lightweight rAF sampler (updated twice a second).
 */
export function useFrameRate(): number {
  const reported = useChrono((s) => s.fps);
  const [local, setLocal] = useState(0);

  useEffect(() => {
    if (reported > 0) return;
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      frames++;
      if (now - last >= 500) {
        setLocal(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reported]);

  return reported > 0 ? Math.round(reported) : local;
}
