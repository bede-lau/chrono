"use client";
import { useSyncExternalStore } from "react";

/** SSR-safe media query (server snapshot = false). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * Compact layout: phones (either orientation — a landscape phone is too short for the side panel), and portrait
 * tablets where a side panel would sit on top of the organism.
 */
export const useIsMobile = () =>
  useMediaQuery("(max-width: 767.98px), (orientation: portrait) and (max-width: 1100px), (max-height: 540px)");
