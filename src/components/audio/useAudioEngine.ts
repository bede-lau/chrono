"use client";
/**
 * useAudioEngine — OWNER: audio agent.
 * Mount once (in the page). Plays specimen.echo (falling back to specimen.voice) while
 * audioEnabled, pushes a smoothed 0..1 level into the store at ~20 Hz for the organism's breath,
 * and returns `{ click }` for wound feedback.
 */
import { useEffect, useRef } from "react";
import { useChrono } from "@/lib/store";
import { click as engineClick, level, rhythmNote, setEnabled, setUrl } from "@/lib/audio/player";

const LEVEL_HZ = 20;
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
    setUrl(audioEnabled ? url : null);
  }, [url, audioEnabled]);

  useEffect(() => {
    // Subscribe directly so the note is scheduled in the same user-gesture turn as tapRhythm.
    // Only a new positive beat in Rhythm mode can sound; resets on load/mode changes stay silent.
    return useChrono.subscribe((state, previous) => {
      if (state.rhythm.at <= 0 || state.rhythm.at === previous.rhythm.at || state.interactionMode !== "rhythm" || !state.audioEnabled || document.hidden) return;
      rhythmNote(state.rhythm.streak, state.rhythm.accuracy);
    });
  }, []);

  useEffect(() => {
    if (!audioEnabled || !url) {
      smoothedRef.current = 0;
      setAudioLevel(0);
      return;
    }
    const tick = () => {
      if (document.hidden) return;
      smoothedRef.current += (level() - smoothedRef.current) * SMOOTHING;
      const value = smoothedRef.current < 0.001 ? 0 : smoothedRef.current;
      if (Math.abs(useChrono.getState().audioLevel - value) >= 0.001) setAudioLevel(value);
    };
    let timer: number | undefined;
    const visibility = () => {
      window.clearInterval(timer);
      timer = undefined;
      if (!document.hidden) timer = window.setInterval(tick, LEVEL_INTERVAL_MS);
    };
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [audioEnabled, url, setAudioLevel]);

  return { click: engineClick };
}
