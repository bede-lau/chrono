"use client";
import { Archive, Camera, Info, Volume2, VolumeX } from "lucide-react";
import { useChrono } from "@/lib/store";
import { capture, toggleAudio } from "./actions";
import { AudioToggle } from "./deps";
import { ICON, IconButton, cx } from "./primitives";
import { SpecimenIdentity } from "./SpecimenIdentity";
import { useUi } from "./uiStore";

export function TopBar({ compact = false }: { compact?: boolean }) {
  const panel = useUi((s) => s.panel);
  const togglePanel = useUi((s) => s.togglePanel);
  const hasSpecimen = useChrono((s) => !!s.specimen);

  return (
    <header
      className={cx(
        "pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3",
        compact
          ? "pt-[calc(var(--safe-top)+12px)] pr-[calc(var(--safe-right)+16px)] pl-[calc(var(--safe-left)+16px)]"
          : "pt-[calc(var(--safe-top)+20px)] pr-[calc(var(--safe-right)+24px)] pl-[calc(var(--safe-left)+24px)]",
      )}
    >
      <div className={cx("pointer-events-auto flex min-w-0 items-start", compact ? "gap-3" : "gap-4")}>
        <h1 className="flex shrink-0 items-center gap-2 text-[15px] font-semibold leading-[18px] tracking-[-0.02em] text-fg-1">
          {/* The name supplies the accessible label; the adjacent mark is decorative. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/chrono-mark.svg" width="20" height="20" alt="" aria-hidden="true" />
          Chrono
        </h1>
        <span role="presentation" className="mt-[2px] h-[14px] w-px shrink-0 bg-white/12" />
        <SpecimenIdentity compact={compact} />
      </div>

      <div className="pointer-events-auto flex shrink-0 items-center gap-2">
        {!compact && <AudioToggle className="backdrop-blur-xl" />}
        <nav aria-label="Specimen" className="flex h-8 items-center rounded-full border border-white/[0.08] bg-white/[0.02] backdrop-blur-xl">
          {compact && <AudioToggleIcon />}
          <IconButton label="Archive" active={panel === "archive"} aria-expanded={panel === "archive"} onClick={() => togglePanel("archive")} size="cluster">
            <Archive {...ICON} />
          </IconButton>
          <IconButton label="Capture PNG" onClick={() => void capture()} disabled={!hasSpecimen} size="cluster">
            <Camera {...ICON} />
          </IconButton>
          <IconButton label="About" active={panel === "info"} aria-expanded={panel === "info"} onClick={() => togglePanel("info")} tipAlign="end" size="cluster">
            <Info {...ICON} />
          </IconButton>
        </nav>
      </div>
    </header>
  );
}

/** Mobile: the audio toggle collapses to a plain icon inside the cluster (the spectrum pill needs room). */
function AudioToggleIcon() {
  const on = useChrono((s) => s.audioEnabled);
  return (
    <IconButton label={on ? "Mute" : "Unmute"} kbd="M" aria-pressed={on} onClick={toggleAudio} size="cluster">
      {on ? <Volume2 {...ICON} /> : <VolumeX {...ICON} />}
    </IconButton>
  );
}
