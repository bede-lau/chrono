"use client";
/**
 * UI actions over the chain controller: one run at a time, abortable, errors surfaced as toasts with Retry.
 */
import { STAGES, type Specimen, type StageId } from "@/lib/chain/types";
import { evolveSpecimen, growSpecimen, loadArchive, loadSpecimen } from "@/lib/chain/controller";
import { unlockAudioContext } from "@/lib/audio/player";
import { useChrono } from "@/lib/store";
import { captureOrganismBlob, captureOrganismPng } from "./deps";
import { isActive } from "./format";
import { useUi } from "./uiStore";

let abort: AbortController | null = null;

export const isBusy = () => useUi.getState().running !== null || useChrono.getState().mode !== "idle";

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

function failedStageTitle(e: unknown): string | null {
  const fromError = e && typeof e === "object" && "stage" in e ? (e as { stage: StageId }).stage : null;
  const runs = useChrono.getState().runs;
  const failed = STAGES.find((s) => s.id === fromError) ?? STAGES.find((s) => runs[s.id]?.status === "failed");
  return failed?.title ?? null;
}

/** After a stop, nothing should keep spinning on the rail. */
function settleActiveRuns() {
  const st = useChrono.getState();
  for (const s of STAGES) if (isActive(st.runs[s.id]?.status)) st.setRun(s.id, { status: "idle" });
  if (st.mode !== "idle") st.setMode("idle", null);
}

async function exclusive(kind: "grow" | "evolve", body: (signal: AbortSignal) => Promise<Specimen>, retry: () => void) {
  if (isBusy()) return;
  const ui = useUi.getState();
  abort = new AbortController();
  ui.setRunning(kind);
  try {
    // The controller streams every artifact and run into the store itself.
    await body(abort.signal);
  } catch (e) {
    if (isAbort(e) || abort?.signal.aborted) {
      settleActiveRuns();
      ui.toast({ kind: "info", title: "Stopped" });
    } else {
      const stage = failedStageTitle(e);
      const st = useChrono.getState();
      if (st.mode !== "idle") st.setMode("idle", null);
      st.pushLog({ level: "error", msg: e instanceof Error ? e.message : String(e) });
      ui.toast({
        kind: "error",
        title: stage ? `Dormant · ${stage} link broke` : "Dormant · chain halted",
        detail: e instanceof Error ? e.message : undefined,
        action: { label: "Retry", run: retry },
      });
    }
  } finally {
    abort = null;
    useUi.getState().setRunning(null);
  }
}

export function newSpecimen() {
  const { controls } = useChrono.getState();
  useChrono.getState().selectStage(null);
  void exclusive("grow", async (signal) => growSpecimen(controls, signal), newSpecimen);
}

export function evolve() {
  const { specimen, pendingWounds, controls } = useChrono.getState();
  if (!specimen) return;
  const wounds = pendingWounds.slice();
  void exclusive(
    "evolve",
    async (signal) => {
      const next = await evolveSpecimen(specimen, wounds, controls, { signal });
      // Consume only the wounds this pass painted; touches made while it ran wait for the next evolve.
      useChrono.setState((s) => ({ pendingWounds: s.pendingWounds.filter((w) => !wounds.includes(w)) }));
      return next;
    },
    evolve,
  );
}

export function stop() {
  abort?.abort();
}

export async function openSpecimen(id: string) {
  if (isBusy()) return;
  const ui = useUi.getState();
  ui.setRunning("load");
  try {
    const s = await loadSpecimen(id);
    if (s && useChrono.getState().specimen?.id !== s.id) useChrono.getState().setSpecimen(s);
    useChrono.getState().clearWounds();
  } catch (e) {
    ui.toast({
      kind: "error",
      title: "Couldn’t open specimen",
      detail: e instanceof Error ? e.message : undefined,
      action: { label: "Retry", run: () => void openSpecimen(id) },
    });
  } finally {
    useUi.getState().setRunning(null);
  }
}

let booted = false;
/** On mount: archive, then the newest specimen, so something is alive on screen immediately. */
export async function bootstrap() {
  if (booted) return;
  booted = true;
  try {
    await loadArchive();
    if (!useChrono.getState().specimen) {
      const newest = [...useChrono.getState().archive].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (newest) await openSpecimen(newest.id);
    }
  } catch {
    useUi.getState().toast({
      kind: "error",
      title: "Archive unavailable",
      action: {
        label: "Retry",
        run: () => {
          booted = false;
          void bootstrap();
        },
      },
    });
  } finally {
    useUi.getState().setBooted(true);
  }
}

function download(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function capture() {
  const { specimen } = useChrono.getState();
  const base = (specimen?.name ?? "organism").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const name = `chrono-${base}-gen${specimen?.generation ?? 0}.png`;
  const ui = useUi.getState();
  try {
    const out: Blob | string | null = (await captureOrganismBlob()) ?? captureOrganismPng();
    ui.flash();
    if (out instanceof Blob) {
      const url = URL.createObjectURL(out);
      download(url, name);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } else if (typeof out === "string") {
      download(out, name);
    } else {
      throw new Error("Nothing to capture yet");
    }
    ui.toast({ kind: "success", title: "Captured", detail: name });
  } catch (e) {
    ui.toast({ kind: "error", title: "Capture failed", detail: e instanceof Error ? e.message : undefined, duration: 3200 });
  }
}

export function toggleAudio() {
  unlockAudioContext(); // key/tap is a user gesture: lets iOS/Safari start the AudioContext
  const st = useChrono.getState();
  st.setAudioEnabled(!st.audioEnabled);
}
