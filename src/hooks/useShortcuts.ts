"use client";
import { useEffect, useRef } from "react";

export interface ShortcutHandlers {
  primary: () => void; // Space: Create / Evolve
  newSpecimen: () => void; // N
  toggleMute: () => void; // M
  inspect: (index: number) => void; // 1–8 → 0..7
  parameters: () => void; // P
  step?: (delta: -1 | 1) => void; // ← / →
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

/**
 * Space activates a focused control — but only when the focus came from the keyboard. A control that merely kept
 * focus after a mouse click/tap gives Space back to the app, so "Space = Create / Evolve" holds for everyone.
 * (`:focus-visible` can't tell: Chrome turns it on for the focused element as soon as any key is pressed.)
 */
function ownsSpace(el: Element | null, pointerFocused: Element | null): boolean {
  if (!el || el === document.body || el === pointerFocused) return false;
  return !!el.closest("button, a[href], summary, [role='button'], [role='tab'], [role='radio'], [role='switch'], [role='checkbox']");
}

/** Arrow keys only mean something on value/choice widgets (not on plain buttons). */
function ownsArrows(el: Element | null): boolean {
  if (!el || el === document.body) return false;
  return !!el.closest("input, select, textarea, [role='slider'], [role='radio'], [role='radiogroup'], [role='tab'], [role='tablist'], [role='listbox'], [role='menu']");
}

/**
 * Global keyboard shortcuts: Space create/evolve · N new specimen · M mute · 1–8 engine · P parameters ·
 * ←/→ step engines · Esc back/close.
 */
export function useShortcuts(handlers: ShortcutHandlers) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    // Which element (if any) received focus from a pointer press rather than from the keyboard.
    let lastPointer = -Infinity;
    let pointerFocused: Element | null = null;
    const onPointer = () => {
      lastPointer = performance.now();
    };
    const onFocusIn = (e: FocusEvent) => {
      pointerFocused = performance.now() - lastPointer < 800 ? (e.target as Element) : null;
    };

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
        if (ownsSpace(target, pointerFocused)) return;
        e.preventDefault();
        if (!e.repeat) h.primary();
        return;
      }
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && h.step && !ownsArrows(target)) {
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
      } else if (k === "p") {
        e.preventDefault();
        h.parameters();
      } else if (/^[1-8]$/.test(e.key)) {
        e.preventDefault();
        h.inspect(Number(e.key) - 1);
      }
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("focusin", onFocusIn, true);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}
