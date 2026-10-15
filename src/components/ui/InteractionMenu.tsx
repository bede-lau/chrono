"use client";

import { Check, ChevronDown, Fingerprint, Lightbulb, MoveHorizontal, Music2, ScanEye, Waves } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { SpecimenInteractionMode } from "@/lib/chain/types";
import { cx } from "./primitives";

const MODES = [
  { value: "touch", label: "Touch", detail: "Leave a mark", icon: Fingerprint },
  { value: "inspect", label: "Inspect", detail: "Read a point", icon: ScanEye },
  { value: "pressure", label: "Pressure test", detail: "Hold to compress", icon: Waves },
  { value: "tug", label: "Entangled tug", detail: "Pull a linked patch", icon: MoveHorizontal },
  { value: "rhythm", label: "Rhythm play", detail: "Tap in time", icon: Music2 },
  { value: "light", label: "Light probe", detail: "Move the study light", icon: Lightbulb },
] as const;

interface MenuPosition {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  maxHeight: number;
}

/** A select-only combobox. Focus stays on the trigger while the active option is announced. */
export function InteractionMenu({ id, value, onChange, describedBy }: {
  id: string;
  value: SpecimenInteractionMode;
  onChange: (value: SpecimenInteractionMode) => void;
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", at: 0 });
  const selected = MODES.findIndex((option) => option.value === value);
  const current = MODES[selected];
  const Icon = current.icon;
  const listId = `${id}-choices`;
  const optionId = (index: number) => `${id}-choice-${index}`;

  function measure(): MenuPosition | null {
    if (!trigger.current) return null;
    const box = trigger.current.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 24);
    const above = box.top - 22;
    const below = window.innerHeight - box.bottom - 22;
    const upward = above >= 312 || above >= below;
    return {
      width,
      left: Math.max(12, Math.min(window.innerWidth - width - 12, box.left + box.width / 2 - width / 2)),
      ...(upward ? { bottom: window.innerHeight - box.top + 10 } : { top: box.bottom + 10 }),
      maxHeight: Math.max(48, Math.min(328, upward ? above : below)),
    };
  }

  function reveal(index = selected) {
    setPosition(measure());
    setActive(index);
    search.current = { text: "", at: 0 };
    setOpen(true);
  }

  function dismiss() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  function choose(index: number) {
    if (MODES[index].value !== value) onChange(MODES[index].value);
    dismiss();
  }

  useEffect(() => {
    if (!open) return;
    const reposition = () => setPosition(measure());
    const close = () => setOpen(false);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("blur", close);
    };
  }, [open]);

  useEffect(() => {
    if (open) menu.current?.querySelector(`[data-choice="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function onKeyDown(event: KeyboardEvent) {
    // Keep mode navigation/typeahead away from the app's engine and paid-run shortcuts.
    event.stopPropagation();
    if (event.key === "Tab") { setOpen(false); return; }
    if (event.key === "Escape") { event.preventDefault(); dismiss(); return; }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!event.repeat) { if (open) choose(active); else reveal(); }
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? MODES.length - 1
        : open ? (active + (event.key === "ArrowDown" ? 1 : -1) + MODES.length) % MODES.length : selected;
      if (open) setActive(next); else reveal(next);
      return;
    }
    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const now = Date.now();
      const letter = event.key.toLowerCase();
      const query = now - search.current.at < 700 ? search.current.text + letter : letter;
      const find = (text: string) => Array.from({ length: MODES.length }, (_, offset) => (active + offset + 1) % MODES.length)
        .find((index) => MODES[index].label.toLowerCase().startsWith(text));
      const match = find(query) ?? find(letter);
      if (!open) reveal(match ?? selected); else if (match !== undefined) setActive(match);
      search.current = { text: query, at: now };
    }
  }

  return (
    <>
      <button ref={trigger} id={id} type="button" role="combobox" aria-label="Interaction" aria-haspopup="listbox"
        aria-expanded={open} aria-controls={open ? listId : undefined} aria-activedescendant={open ? optionId(active) : undefined}
        aria-describedby={describedBy} onKeyDown={onKeyDown} onClick={() => open ? dismiss() : reveal()}
        onBlur={(event) => { if (!menu.current?.contains(event.relatedTarget)) setOpen(false); }}
        className={cx("flex h-8 w-[156px] items-center gap-2 rounded-full border px-3 text-left text-[11px] text-fg-1 transition-colors focus-visible:outline focus-visible:outline-white/70", open ? "border-white/25 bg-white/[0.1]" : "border-white/[0.09] bg-white/[0.055] hover:bg-white/[0.09]")}>
        <Icon size={14} strokeWidth={1.5} className="shrink-0 text-fg-2" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{current.label}</span>
        <ChevronDown size={12} strokeWidth={1.5} className={cx("shrink-0 text-fg-2 transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
      </button>
      {open && position && createPortal(
        <div data-interaction-controls className="fixed inset-0 z-[80]" onKeyDown={onKeyDown}
          onPointerDown={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); event.stopPropagation(); dismiss(); } }}>
          <div ref={menu} id={listId} role="listbox" aria-label="Interaction modes"
            className="thin-scrollbar fixed overflow-y-auto rounded-[14px] border border-white/[0.14] bg-[#101012] p-1.5 shadow-[0_16px_48px_rgb(0_0_0/0.55),0_2px_8px_rgb(0_0_0/0.35)]"
            style={position}>
            {MODES.map((option, index) => {
              const ModeIcon = option.icon;
              const checked = option.value === value;
              return <button key={option.value} id={optionId(index)} data-choice={index} type="button" role="option"
                aria-selected={checked} aria-labelledby={`${optionId(index)}-label`} aria-describedby={`${optionId(index)}-detail`} tabIndex={-1}
                onPointerDown={(event) => event.preventDefault()} onPointerMove={() => setActive(index)} onClick={() => choose(index)}
                className={cx("flex min-h-12 w-full items-center gap-3 rounded-[9px] px-3 py-2 text-left outline-none transition-colors duration-100", active === index ? "bg-white/[0.1]" : checked ? "bg-white/[0.055]" : "hover:bg-white/[0.06]")}>
                <ModeIcon size={17} strokeWidth={1.5} className={cx("shrink-0", checked || active === index ? "text-fg-1" : "text-fg-2")} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span id={`${optionId(index)}-label`} className="block text-[12px] font-medium leading-4 text-fg-1">{option.label}</span>
                  <span id={`${optionId(index)}-detail`} className="mt-0.5 block text-[10.5px] leading-[14px] text-fg-2">{option.detail}</span>
                </span>
                {checked && <Check size={14} strokeWidth={1.5} className="shrink-0 text-fg-1" aria-hidden />}
              </button>;
            })}
          </div>
        </div>, document.body,
      )}
    </>
  );
}
