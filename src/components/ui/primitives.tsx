"use client";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
export const T_FAST = { duration: 0.2, ease: EASE_OUT };
export const T = { duration: 0.3, ease: EASE_OUT };
export const T_SLOW = { duration: 0.4, ease: EASE_OUT };

export const ICON = { size: 16, strokeWidth: 1.5 } as const;

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border border-white/10 px-1 font-mono text-[10px] leading-none text-fg-2",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** Hover / keyboard-focus tooltip. Pure CSS, delayed, never blocks pointer events. */
export function Tip({ label, kbd, side = "bottom", align = "center" }: { label: string; kbd?: string; side?: "top" | "bottom"; align?: "center" | "end" | "start" }) {
  return (
    <span
      role="presentation"
      className={cx(
        "pointer-events-none absolute z-50 flex items-center gap-1.5 whitespace-nowrap rounded-[7px] glass-strong px-2 py-1 text-[11px] font-medium text-fg-1 opacity-0 shadow-lg shadow-black/40",
        "transition-[opacity,translate] duration-200 ease-out [transition-delay:0ms] group-hover:opacity-100 group-hover:[transition-delay:350ms] group-has-[:focus-visible]:opacity-100",
        side === "bottom" ? "top-full mt-2 translate-y-[-2px] group-hover:translate-y-0" : "bottom-full mb-2 translate-y-[2px] group-hover:translate-y-0",
        align === "center" && "left-1/2 -translate-x-1/2",
        align === "end" && "right-0",
        align === "start" && "left-0",
      )}
    >
      {label}
      {kbd && <Kbd className="h-4 min-w-4 text-[9.5px]">{kbd}</Kbd>}
    </span>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  kbd?: string;
  tipSide?: "top" | "bottom";
  tipAlign?: "center" | "end" | "start";
  active?: boolean;
  size?: "xs" | "sm" | "cluster" | "md";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, kbd, tipSide = "bottom", tipAlign = "center", active, size = "md", className, children, ...rest },
  ref,
) {
  return (
    <span className="group relative inline-flex">
      <button
        ref={ref}
        type="button"
        aria-label={label}
        className={cx(
          "grid place-items-center rounded-full transition-[background-color,color,opacity] duration-200 ease-out disabled:opacity-35",
          { xs: "size-6", sm: "size-7", cluster: "size-[30px]", md: "size-8" }[size],
          active ? "bg-white/10 text-fg-1" : "text-fg-2 hover:bg-white/6 hover:text-fg-1 active:bg-white/10",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
      <Tip label={label} kbd={kbd} side={tipSide} align={tipAlign} />
    </span>
  );
});

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={cx("spin", className)} aria-hidden>
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.5" />
      <path d="M8 1.75a6.25 6.25 0 0 1 6.25 6.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function Hairline({ className }: { className?: string }) {
  return <div role="presentation" className={cx("h-px w-full bg-hairline", className)} />;
}
