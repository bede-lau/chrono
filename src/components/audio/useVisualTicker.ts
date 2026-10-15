"use client";
import { useEffect, useEffectEvent } from "react";

/** Audio meters need modest redraw rates; muted/hidden meters need no recurring work. */
export function useVisualTicker(draw: () => void, active: boolean, hz = 20) {
  const paint = useEffectEvent(draw);
  useEffect(() => {
    let timer: number | undefined;
    const tick = () => { if (!document.hidden) paint(); };
    const visibility = () => {
      window.clearInterval(timer);
      timer = undefined;
      if (document.hidden) return;
      tick();
      if (active) timer = window.setInterval(tick, 1000 / hz);
    };
    visibility();
    window.addEventListener("resize", tick);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", tick);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [active, hz]);
}
