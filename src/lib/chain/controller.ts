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
import { isResumableRemoteJobError } from "../moth/job";
import { getRunApiKey } from "../moth/sessionKey";
import { ChainHaltedError, evolveChain, growChain, resumeChain, type ArtifactSink, type ChainReporter } from "./pipeline";
import { STAGES, type ArchiveIndex, type Controls, type Specimen, type Wound } from "./types";

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

// Store only credential fingerprints alongside in-memory runs, never credentials in specimen data.
const credentialScopes = new Map<string, string>();
const scopeId = (s: Specimen) => `${s.createdAt}:${s.generation}`;

async function runCredential() {
  const apiKey = getRunApiKey();
  const digest = apiKey ? await crypto.subtle.digest("SHA-256", new TextEncoder().encode(apiKey)) : null;
  const scope = digest ? Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("") : "app";
  return { apiKey, scope };
}

function storeReporter(scope: string): ChainReporter {
  const st = () => useChrono.getState();
  return {
    setSpecimen: (s) => {
      credentialScopes.set(scopeId(s), scope);
      while (credentialScopes.size > 64) credentialScopes.delete(credentialScopes.keys().next().value!);
      st().setSpecimen(s);
    },
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
  const credential = await runCredential();
  const ctrl = begin(signal);
  try {
    return await growChain(
      { transport: createBrowserTransport("/api/moth", { signal: ctrl.signal, apiKey: credential.apiKey }), sink: browserSink(), reporter: storeReporter(credential.scope) },
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
  const credential = await runCredential();
  const previousScope = credentialScopes.get(scopeId(base));
  // Atlas assets belong to an account. Upload the cached pixels when crossing credential scopes.
  const reupload = previousScope ? previousScope !== credential.scope : !!credential.apiKey;
  const input = reupload && base.skin ? { ...base, skin: { ...base.skin, assetId: undefined } } : base;
  const ctrl = begin(opts?.signal);
  try {
    const s = await evolveChain(
      { transport: createBrowserTransport("/api/moth", { signal: ctrl.signal, apiKey: credential.apiKey }), sink: browserSink(), reporter: storeReporter(credential.scope) },
      input,
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

/**
 * Reconnect to a partial in-memory specimen. A local timeout, abort, poll outage, or result/download
 * outage does not mean Atlas stopped the remote job. `resumeChain` preserves that job id and polls it
 * instead of submitting a duplicate. Blob-backed browser artifacts cannot survive a full page reload.
 */
export async function resumeSpecimen(partial: Specimen, signal?: AbortSignal): Promise<Specimen> {
  const credential = await runCredential();
  const previousScope = credentialScopes.get(scopeId(partial));
  if (previousScope && previousScope !== credential.scope) {
    const error = new Error("This pending job uses a different Moth key. Check the original key to resume, or choose New specimen.");
    error.name = "MothCredentialMismatch";
    throw error;
  }
  const ctrl = begin(signal);
  try {
    const result = await resumeChain(
      { transport: createBrowserTransport("/api/moth", { signal: ctrl.signal, apiKey: credential.apiKey }), sink: browserSink(), reporter: storeReporter(credential.scope) },
      partial,
      { signal: ctrl.signal },
    );
    // Evolve consumes the snapshot of wounds it sent downstream. A resumed evolve is the same pass,
    // so remove those values only after Atlas has completed it; new touches stay pending.
    const applied = partial.wounds ?? [];
    if (partial.generation > 0 && applied.length) {
      useChrono.setState((st) => ({
        pendingWounds: st.pendingWounds.filter((w) => !applied.some((a) => a.u === w.u && a.v === w.v && a.strength === w.strength && a.t === w.t)),
      }));
    }
    return result;
  } finally {
    end(ctrl);
  }
}

/** Whether this currently loaded partial has an Atlas job that can be re-polled without resubmission. */
export function hasResumableRemoteJob(specimen: Specimen | null): boolean {
  return Object.values(specimen?.runs ?? {}).some((run) => run?.status === "failed" && isResumableRemoteJobError(run.errorType) && !!run.jobId);
}

/** A failed partial can continue at the first unfinished stage without discarding completed engines. */
export function canContinuePartial(specimen: Specimen | null = useChrono.getState().specimen): boolean {
  if (!specimen) return false;
  const first = STAGES.findIndex(({ id }) => !["done", "cached"].includes(specimen.runs[id]?.status ?? "idle"));
  return first > 0 && specimen.runs[STAGES[first].id]?.status === "failed";
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
