"use client";
/**
 * UI actions over the chain controller: one run at a time, abortable, errors surfaced as toasts with Retry.
 * Also the right panel's navigation (Parameters | Evolution, stage choice, follow mode).
 */
import { STAGES, type ArchiveIndex, type Specimen, type StageId } from "@/lib/chain/types";
import { evolveSpecimen, growSpecimen, loadSpecimen } from "@/lib/chain/controller";
import { unlockAudioContext } from "@/lib/audio/player";
import { useChrono } from "@/lib/store";
import { captureOrganismBlob, captureOrganismPng } from "./deps";
import { isActive } from "./format";
import { useUi } from "./uiStore";

let abort: AbortController | null = null;

export const isBusy = () => useUi.getState().running !== null || useChrono.getState().mode !== "idle";

/** Evolve needs what genesis → morphogenesis produced; anything less (none, or a stopped Create) means Create. */
export const canEvolve = (s: Specimen | null = useChrono.getState().specimen) => !!(s?.genome && s.colony && s.skin);

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

function failedStageTitle(e: unknown): string | null {
  const fromError = e && typeof e === "object" && "stage" in e ? (e as { stage: StageId }).stage : null;
  const runs = useChrono.getState().runs;
  const failed = STAGES.find((s) => s.id === fromError) ?? STAGES.find((s) => runs[s.id]?.status === "failed");
  return failed?.title ?? null;
}

/** After a stop nothing keeps spinning, and the stage that was interrupted reads idle, not failed. */
function settleActiveRuns() {
  const st = useChrono.getState();
  for (const s of STAGES) {
    const r = st.runs[s.id];
    if (isActive(r?.status) || (r?.status === "failed" && r.error === "aborted")) st.setRun(s.id, { status: "idle", error: undefined });
  }
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

/** Create: grow a brand-new specimen from genesis with the current controls. */
export function create() {
  if (isBusy()) return;
  // Start/resume Web Audio in this click's gesture and leave the user's audio preference enabled.
  unlockAudioContext();
  const st = useChrono.getState();
  st.setAudioEnabled(true);
  const { controls } = st;
  void exclusive("grow", (signal) => growSpecimen(controls, signal), create);
}

export function evolve() {
  const { specimen, pendingWounds, controls } = useChrono.getState();
  if (!specimen || !canEvolve(specimen)) return;
  const wounds = pendingWounds.slice();
  void exclusive(
    "evolve",
    // The controller consumes exactly these wounds on success; touches made meanwhile stay pending.
    (signal) => evolveSpecimen(specimen, wounds, controls, { signal }),
    evolve,
  );
}

/** The one primary action: Create until there is a specimen to build on, Evolve afterwards. */
export function primary() {
  if (isBusy()) return;
  if (canEvolve()) evolve();
  else create();
}

export function stop() {
  abort?.abort();
}

/** Back to the blank "New specimen" state. Keeps the slider values; never grows by itself. */
export function newSpecimen() {
  if (isBusy() || !useChrono.getState().specimen) return;
  useChrono.getState().resetToNew();
  const ui = useUi.getState();
  ui.setFollow(false);
  ui.setLastStage(null);
  ui.setTab("parameters");
}

/* ---------------------------------------------------------------- right panel navigation */

/** Show the right panel: desktop uncovers it (Archive/Info give way), mobile opens the sheet. */
function revealPanel() {
  const ui = useUi.getState();
  if (ui.mobile) {
    if (ui.panel !== "sheet") ui.openPanel("sheet");
  } else if (ui.panel) ui.openPanel(null);
}

/** Stage the Evolution view shows: the chosen one, else the running one, else 01. */
export function viewStage(): StageId {
  const st = useChrono.getState();
  return st.selectedStage ?? st.activeStage ?? STAGES[0].id;
}

/** A manual stage choice (rail, keys, stepper, link chip): that engine's Evolution view, at once. Ends follow mode. */
export function openStage(id: StageId, reveal = true) {
  const ui = useUi.getState();
  ui.setFollow(false);
  if (ui.tab !== "evolution") ui.setTab("evolution");
  if (useChrono.getState().selectedStage !== id) useChrono.getState().selectStage(id);
  if (reveal) revealPanel();
}

/** The Evolution toggle: back to the engine you were reading (else the running one, else 01). */
export function openEvolution(reveal = true) {
  openStage(useChrono.getState().selectedStage ?? useUi.getState().lastStage ?? viewStage(), reveal);
}

/** Parameters: no engine is open any more (the rail drops its selection, the lens switches off). */
export function openParameters(reveal = true) {
  const ui = useUi.getState();
  const st = useChrono.getState();
  ui.setFollow(false);
  if (st.selectedStage) {
    ui.setLastStage(st.selectedStage);
    st.selectStage(null);
  }
  if (ui.tab !== "parameters") ui.setTab("parameters");
  if (reveal) revealPanel();
}

/** Previous / next engine in the chain (clamped: the chain has a first and a last link). */
export function stepStage(d: -1 | 1) {
  const i = STAGES.findIndex((s) => s.id === viewStage());
  const next = STAGES[Math.min(STAGES.length - 1, Math.max(0, i + d))];
  if (next) openStage(next.id, false);
}

/** EvolutionView's Pin: keep this stage, stop following. */
export function pinStage() {
  useUi.getState().setFollow(false);
}

/**
 * Follow mode. A new run (mode leaves "idle") switches the panel to Evolution and tracks `activeStage` until the
 * user makes a manual choice; when the run ends the panel stays on the last stage. Returns the unsubscribe.
 */
export function watchRuns(): () => void {
  return useChrono.subscribe((s, prev) => {
    if (s.mode === prev.mode && s.activeStage === prev.activeStage) return;
    const started = prev.mode === "idle" && s.mode !== "idle";
    const ended = prev.mode !== "idle" && s.mode === "idle";
    // Deferred out of the store notification (no re-entrant set), still before the next paint.
    queueMicrotask(() => {
      const ui = useUi.getState();
      if (started) {
        ui.setFollow(true);
        ui.setTab("evolution");
        if (ui.panel === "archive") ui.openPanel(null);
      }
      if (ended) {
        ui.setFollow(false);
        return;
      }
      const st = useChrono.getState();
      if (st.mode !== "idle" && useUi.getState().follow && st.activeStage && st.selectedStage !== st.activeStage) st.selectStage(st.activeStage);
    });
  });
}

/* ---------------------------------------------------------------- specimens */

export async function openSpecimen(id: string) {
  if (isBusy()) return;
  const ui = useUi.getState();
  ui.setRunning("load");
  try {
    const s = await loadSpecimen(id);
    const st = useChrono.getState();
    if (s && st.specimen?.id !== s.id) st.setSpecimen(s);
    st.clearWounds();
    // The sliders describe the specimen on screen: adopt the controls it was grown with, so nothing reads "pending".
    if (s?.controls) st.setControls({ ...s.controls });
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

let listing: Promise<void> | null = null;
/** public/specimens/index.json → `archive`. The list only: opening one is always the user's choice. */
export function loadArchiveList(): Promise<void> {
  listing ??= (async () => {
    try {
      const res = await fetch("/specimens/index.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      useChrono.getState().setArchive(((await res.json()) as ArchiveIndex).specimens ?? []);
    } catch {
      listing = null; // the drawer retries when it opens; Create never needs the archive
    }
  })();
  return listing;
}

let booted = false;
/** On mount: the archive list only. Every visit starts at "New specimen"; nothing runs until the user asks. */
export async function bootstrap() {
  if (booted) return;
  booted = true;
  await loadArchiveList();
  useUi.getState().setBooted(true);
}

/* ---------------------------------------------------------------- capture + audio */

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
