"use client";
/**
 * useAudioEngine — OWNER: audio agent.
 * Mount once (in the page). Plays specimen.echo (falling back to specimen.voice) while
 * audioEnabled, pushes a smoothed 0..1 level into the store at ~30 Hz for the organism's breath,
 * and returns `{ click }` for wound feedback.
 */
import { useEffect, useRef } from "react";
import { useChrono } from "@/lib/store";
import { click as engineClick, level, setEnabled, setUrl } from "@/lib/audio/player";

const LEVEL_HZ = 30;
const LEVEL_INTERVAL_MS = 1000 / LEVEL_HZ;
const SMOOTHING = 0.25;

export interface UseAudioEngine {
  click: (strength?: number) => void;
}

export function useAudioEngine(): UseAudioEngine {
  const audioEnabled = useChrono((s) => s.audioEnabled);
  const url = useChrono((s) => s.specimen?.echo?.url ?? s.specimen?.voice?.url ?? null);
  const setAudioLevel = useChrono((s) => s.setAudioLevel);
  const smoothedRef = useRef(0);

  useEffect(() => {
    setEnabled(audioEnabled);
  }, [audioEnabled]);

  useEffect(() => {
    setUrl(url);
  }, [url]);

  useEffect(() => {
    let raf = 0;
    let lastTick = 0;
    const tick = (t: number) => {
      if (t - lastTick >= LEVEL_INTERVAL_MS) {
        lastTick = t;
        const target = level();
        smoothedRef.current += (target - smoothedRef.current) * SMOOTHING;
        setAudioLevel(smoothedRef.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [setAudioLevel]);

  return { click: engineClick };
}
