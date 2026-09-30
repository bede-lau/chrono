"use client";
import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * While `active`: move focus into the container, keep Tab cycling inside it (only when `cycle` — modal surfaces;
 * a non-modal drawer lets Tab leave), and give focus back to whatever had it before when the container closes.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, cycle = true) {
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement as HTMLElement | null;

    const items = () =>
      Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);

    // Focus the container itself (not its first button) so no tooltip/ring flashes on open; Tab enters the list.
    const first = root.querySelector<HTMLElement>("[data-autofocus]") ?? root;
    // Let the enter animation mount before stealing focus.
    const raf = requestAnimationFrame(() => first.focus({ preventScroll: true }));

    const onKey = (e: KeyboardEvent) => {
      if (!cycle || e.key !== "Tab") return;
      const list = items();
      if (list.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const a = list[0];
      const z = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === a || document.activeElement === root || !root.contains(document.activeElement))) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && (document.activeElement === z || !root.contains(document.activeElement))) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [ref, active, cycle]);
}
