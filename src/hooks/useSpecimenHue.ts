"use client";
import { useEffect } from "react";
import { useChrono } from "@/lib/store";

/**
 * Sets `--specimen-hue` on <html> from the colony's dominant nucleus (colony.bloch[0] → atan2(y, x)).
 * The property is registered in globals.css, so the accent glides between specimens.
 */
export function useSpecimenHue() {
  const nucleus = useChrono((s) => s.specimen?.colony?.bloch?.[0]);
  useEffect(() => {
    if (!nucleus) return;
    const hue = ((Math.atan2(nucleus.y, nucleus.x) * 180) / Math.PI + 360) % 360;
    document.documentElement.style.setProperty("--specimen-hue", hue.toFixed(1));
  }, [nucleus]);
}
