/**
 * State Pipeline Controller (PRD 4.2). OWNER: pipeline agent.
 * Runs the daisy chain, streaming progress into the zustand store (useChrono) so the UI animates stage by stage.
 *
 * Browser-side entry points. The chain itself lives in ./pipeline (isomorphic, dependency-injected); this file binds
 * it to the /api/moth proxy transport, blob-URL artifact storage and the useChrono store.
 *
 * Failure contract: when a stage fails, downstream stages do not run, the failed stage's run has status "failed"
 * with `error`, mode returns to "idle", and the promise rejects with a `ChainHaltedError` (`.stage`, `.specimen`
 * = the partial, dormant specimen still shown on screen). Aborts reject with an `AbortError`.
 */
import { useChrono } from "../store";
import { createBrowserTransport } from "../moth/browser";
import { ChainHaltedError, evolveChain, growChain, type ArtifactSink, type ChainReporter } from "./pipeline";
import type { ArchiveIndex, Controls, Specimen, Wound } from "./types";

export { ChainHaltedError } from "./pipeline";

/** Browser artifact storage: blob: URLs (read back via fetch, which also handles /specimens/... and data: URLs). */
export function browserSink(): ArtifactSink {
  return {
    async write(_specimenId, _name, bytes, contentType) {
      return URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: contentType }));
    },
    async read(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`read ${url}: HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

function storeReporter(): ChainReporter {
  const st = () => useChrono.getState();
  return {
    setSpecimen: (s) => st().setSpecimen(s),
    patchSpecimen: (p) => st().patchSpecimen(p),
    setRun: (id, r) => st().setRun(id, r),
    setMode: (m, active) => st().setMode(m, active ?? null),
    pushLog: (l) => st().pushLog(l),
  };
}

/** One chain at a time: starting a new grow/evolve aborts the previous one. */
let current: AbortController | null = null;
function begin(external?: AbortSignal): AbortController {
  current?.abort();
  const ctrl = new AbortController();
  current = ctrl;
  if (external) {
    if (external.aborted) ctrl.abort();
    else external.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  return ctrl;
}
function end(ctrl: AbortController) {
  if (current === ctrl) current = null;
}

/** Abort the running chain, if any. */
export function cancelChain(): void {
  current?.abort();
}

/** Full chain from genesis: QRNG -> Graph -> Tessa -> Blur -> Blur Core -> Shader -> QRC Audio -> Echo. */
export async function growSpecimen(controls: Controls, signal?: AbortSignal): Promise<Specimen> {
  const ctrl = begin(signal);
  try {
    return await growChain(
      { transport: createBrowserTransport(), sink: browserSink(), reporter: storeReporter() },
      controls,
      { signal: ctrl.signal },
    );
  } finally {
    end(ctrl);
  }
}

/**
 * Re-run from decoherence onward, re-using genesis/colony/morphogenesis artifacts (status "cached").
 * `wounds` are painted into the blur mask. Audio stages may be skipped when `withAudio` is false
 * (then voice/echo keep the previous artifacts and are marked "cached").
 */
export async function evolveSpecimen(
  base: Specimen,
  wounds: Wound[],
  controls: Controls,
  opts?: { withAudio?: boolean; signal?: AbortSignal },
): Promise<Specimen> {
  const ctrl = begin(opts?.signal);
  try {
    const s = await evolveChain(
      { transport: createBrowserTransport(), sink: browserSink(), reporter: storeReporter() },
      base,
      wounds,
      controls,
      { signal: ctrl.signal, withAudio: opts?.withAudio },
    );
    // Consume exactly the wounds that went into this pass (new touches made meanwhile stay pending).
    useChrono.setState((st) => ({ pendingWounds: st.pendingWounds.filter((w) => !wounds.includes(w)) }));
    return s;
  } finally {
    end(ctrl);
  }
}

/** Load the archive list only. Opening a specimen is always an explicit user action. */
export async function loadArchive(): Promise<void> {
  let list: ArchiveIndex["specimens"] = [];
  try {
    const res = await fetch("/specimens/index.json", { cache: "no-store" });
    if (res.ok) list = ((await res.json()) as ArchiveIndex).specimens ?? [];
  } catch {
    list = [];
  }
  const st = useChrono.getState();
  st.setArchive(list);
}

/** Fetch /specimens/<id>/manifest.json, put it on screen (setSpecimen) and return it. */
export async function loadSpecimen(id: string): Promise<Specimen> {
  const res = await fetch(`/specimens/${encodeURIComponent(id)}/manifest.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`specimen ${id}: HTTP ${res.status}`);
  const s = (await res.json()) as Specimen;
  const st = useChrono.getState();
  if (st.mode === "idle") st.setSpecimen(s);
  return s;
}

export function isChainHalted(e: unknown): e is ChainHaltedError {
  return e instanceof ChainHaltedError;
}
