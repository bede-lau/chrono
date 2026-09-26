"use client";
import { useEffect, useRef } from "react";

export interface ShortcutHandlers {
  evolve: () => void; // Space
  newSpecimen: () => void; // N
  toggleMute: () => void; // M
  inspect: (index: number) => void; // 1–8 → 0..7
  step?: (delta: -1 | 1) => void; // ← / → while a stage is inspected
  escape: () => void; // Esc
}

const TEXT_ENTRY = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** Typing somewhere: never steal keys. */
function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  if (!TEXT_ENTRY.has(el.tagName)) return false;
  const type = (el as HTMLInputElement).type;
  return !(el.tagName === "INPUT" && ["range", "checkbox", "radio", "button"].includes(type));
}

/** Space/arrows already mean something on buttons, links and sliders. */
function ownsSpaceOrArrows(el: Element | null): boolean {
  if (!el || el === document.body) return false;
  return !!el.closest("button, a[href], input, select, textarea, summary, [role='button'], [role='slider'], [role='radio'], [role='tab']");
}

/**
 * Global keyboard shortcuts: Space evolve · N new specimen · M mute · 1–8 inspect stage · ←/→ step · Esc close.
 */
export function useShortcuts(handlers: ShortcutHandlers) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const h = ref.current;
      const target = document.activeElement;

      if (e.key === "Escape") {
        h.escape();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTextEntry(target)) return;

      if (e.code === "Space" || e.key === " ") {
        if (ownsSpaceOrArrows(target) || e.repeat) return;
        e.preventDefault();
        h.evolve();
        return;
      }
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && h.step && !ownsSpaceOrArrows(target)) {
        e.preventDefault();
        h.step(e.key === "ArrowLeft" ? -1 : 1);
        return;
      }
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === "n") {
        e.preventDefault();
        h.newSpecimen();
      } else if (k === "m") {
        e.preventDefault();
        h.toggleMute();
      } else if (/^[1-8]$/.test(e.key)) {
        e.preventDefault();
        h.inspect(Number(e.key) - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
