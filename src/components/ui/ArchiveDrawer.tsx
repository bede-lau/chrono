"use client";
import { useEffect } from "react";
import Image from "next/image";
import { useChrono } from "@/lib/store";
import { loadArchiveList, openSpecimen } from "./actions";
import { formatDate } from "./format";
import { Panel, PanelClose } from "./Panel";
import { cx } from "./primitives";
import { useUi } from "./uiStore";
import { useRunProgress } from "./ControlsCard";

export function ArchiveDrawer({ mobile }: { mobile: boolean }) {
  const open = useUi((s) => s.panel === "archive");
  const openPanel = useUi((s) => s.openPanel);
  const archive = useChrono((s) => s.archive);
  const currentId = useChrono((s) => s.specimen?.id);
  const { busy } = useRunProgress();
  const close = () => openPanel(null);
  const sorted = [...archive].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // The list loads on boot; if that failed (offline), try again whenever the drawer opens.
  useEffect(() => {
    if (open && useChrono.getState().archive.length === 0) void loadArchiveList();
  }, [open]);

  return (
    <Panel open={open} onClose={close} label="Archive" mobile={mobile}>
      <header className="flex shrink-0 items-center justify-between px-5 pt-4 pb-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-fg-1">Archive</h2>
          <span className="font-mono text-[11px] tabular text-fg-3">{archive.length}</span>
        </div>
        <div className="-mr-1.5">
          <PanelClose onClose={close} />
        </div>
      </header>
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
        {sorted.length === 0 ? (
          <p className="py-10 text-center font-mono text-[11px] text-fg-3">No specimens yet</p>
        ) : (
          <ul className="grid grid-cols-2 gap-x-3 gap-y-4">
            {sorted.map((s) => {
              const current = s.id === currentId;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={busy}
                    aria-current={current ? "true" : undefined}
                    aria-label={`${s.name}, generation ${s.generation}${current ? ", on screen" : ""}`}
                    onClick={() => {
                      // Picking one hands the stage back to the panel at once (it reads Evolve when the specimen lands).
                      close();
                      if (!current) void openSpecimen(s.id);
                    }}
                    className="group block w-full rounded-[12px] text-left disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span
                      className={cx(
                        "relative block aspect-square overflow-hidden rounded-[12px] bg-white/[0.035] transition-[box-shadow] duration-200",
                        current ? "shadow-[0_0_0_1.5px_rgb(255_255_255/0.7)]" : "shadow-[inset_0_0_0_1px_var(--hairline)] group-hover:shadow-[0_0_0_1px_rgb(255_255_255/0.3)]",
                      )}
                    >
                      {s.thumb && (
                        <Image
                          src={s.thumb}
                          alt=""
                          fill
                          sizes="170px"
                          unoptimized
                          className="pixelated object-cover transition-transform duration-400 ease-out group-hover:scale-[1.03]"
                        />
                      )}
                    </span>
                    <span className="mt-2 flex items-baseline justify-between gap-2">
                      <span className="truncate text-[12px] font-medium text-fg-1">{s.name}</span>
                      <span className="shrink-0 font-mono text-[10.5px] tabular text-fg-3">G{s.generation}</span>
                    </span>
                    <span className="block font-mono text-[10.5px] text-fg-3">{current ? "On screen" : formatDate(s.createdAt)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Panel>
  );
}
