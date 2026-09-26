"use client";
/**
 * TEMPORARY mock of src/lib/chain/controller.ts (same signatures). Streams fake progress into the store so
 * every rail state (running, retrying, done, cached, failed) can be exercised. `?mockfail=<stageId>` forces a
 * failure at that stage; `?mockfast` shortens stage timings.
 */
import { STAGES, type Controls, type Specimen, type StageId, type Wound } from "@/lib/chain/types";
import { useChrono } from "@/lib/store";
import { mockArtifacts, mockRun, mockSpecimen, rng } from "./mockSpecimen";

const IDS = ["7f3a9c", "c41e07", "2b9d55", "e06a1f", "91c3b8", "5da2e4"];

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

function flags() {
  if (typeof window === "undefined") return { fail: null as string | null, fast: false };
  const q = new URLSearchParams(window.location.search);
  return { fail: q.get("mockfail"), fast: q.has("mockfast") };
}

export async function loadArchive(): Promise<void> {
  await sleep(120);
  const specimens = IDS.map((id, i) => {
    const s = mockSpecimen(id, (i * 3) % 5);
    return { id, name: s.name, createdAt: new Date(Date.now() - i * 86400_000 * 0.7).toISOString(), generation: s.generation, thumb: s.skin?.url ?? "" };
  });
  useChrono.getState().setArchive(specimens);
}

export async function loadSpecimen(id: string): Promise<Specimen> {
  await sleep(160);
  const entry = useChrono.getState().archive.find((a) => a.id === id);
  const s = mockSpecimen(id, entry?.generation ?? 0);
  useChrono.getState().setSpecimen(s);
  return s;
}

async function runStages(ids: StageId[], seed: string, apply: (id: StageId) => void, signal?: AbortSignal) {
  const st = useChrono.getState();
  const { fail, fast } = flags();
  const k = fast ? 0.35 : 1;
  for (const id of ids) {
    const meta = STAGES.find((s) => s.id === id)!;
    const mode = useChrono.getState().mode;
    st.setMode(mode === "idle" ? "growing" : mode, id);
    st.setRun(id, { status: "queued", attempt: 1, startedAt: Date.now(), error: undefined, latencyMs: undefined });
    st.pushLog({ stage: id, level: "info", msg: `${meta.engineId} submitted` });
    await sleep(350 * k, signal);
    st.setRun(id, { status: "running" });
    if (id === "morphogenesis") {
      await sleep(900 * k, signal);
      st.setRun(id, { status: "retrying", attempt: 2, error: "engine_timeout (retryable)" });
      st.pushLog({ stage: id, level: "warn", msg: "engine_timeout · retry 2/6 in 5 s" });
      await sleep(1100 * k, signal);
      st.setRun(id, { status: "running" });
    }
    await sleep((700 + rng(seed + id)() * 900) * k, signal);
    if (fail === id) {
      st.setRun(id, { status: "failed", error: "engine_error: backend unavailable", finishedAt: Date.now() });
      st.pushLog({ stage: id, level: "error", msg: `${meta.engineId} failed — lifecycle halted` });
      throw new Error(`${meta.title} failed: backend unavailable`);
    }
    const run = mockRun(id, seed, { startedAt: Date.now() - 3000, finishedAt: Date.now() });
    st.setRun(id, { ...run, attempt: useChrono.getState().runs[id]?.attempt ?? 1 });
    apply(id);
    st.pushLog({ stage: id, level: "ok", msg: `${meta.engineId} done · ${(run.latencyMs! / 1000).toFixed(1)} s` });
  }
}

export async function growSpecimen(controls: Controls, signal?: AbortSignal): Promise<Specimen> {
  const st = useChrono.getState();
  const id = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
  const full = mockArtifacts(id, 0, controls);
  const base: Specimen = { id, name: `Specimen ${id.slice(0, 4).toUpperCase()}`, createdAt: new Date().toISOString(), generation: 0, controls, wounds: [], runs: {} };
  st.setSpecimen(base);
  st.setMode("growing", "genesis");
  const artifactOf: Record<StageId, Partial<Specimen>> = {
    genesis: { genome: full.genome },
    colony: { colony: full.colony },
    morphogenesis: { skin: full.skin },
    decoherence: { tissue: full.tissue },
    soma: { soma: full.soma },
    membrane: { membrane: full.membrane, metrics: full.metrics },
    voice: { voice: full.voice },
    echo: { echo: full.echo },
  };
  try {
    await runStages(STAGES.map((s) => s.id), id, (sid) => useChrono.getState().patchSpecimen(artifactOf[sid]), signal);
  } finally {
    useChrono.getState().setMode("idle", null);
  }
  return useChrono.getState().specimen!;
}

export async function evolveSpecimen(
  base: Specimen,
  wounds: Wound[],
  controls: Controls,
  opts?: { withAudio?: boolean; signal?: AbortSignal },
): Promise<Specimen> {
  const st = useChrono.getState();
  const gen = base.generation + 1;
  const next = mockArtifacts(base.id, gen, controls, wounds);
  st.setMode("evolving", "decoherence");
  st.resetRuns(["genesis", "colony", "morphogenesis"]);
  (["genesis", "colony", "morphogenesis"] as StageId[]).forEach((id) => st.setRun(id, { status: "cached" }));
  const artifactOf: Partial<Record<StageId, Partial<Specimen>>> = {
    decoherence: { tissue: next.tissue, wounds },
    soma: { soma: next.soma },
    membrane: { membrane: next.membrane, metrics: next.metrics },
    voice: { voice: next.voice },
    echo: { echo: next.echo, generation: gen },
  };
  const ids: StageId[] = opts?.withAudio === false ? ["decoherence", "soma", "membrane"] : ["decoherence", "soma", "membrane", "voice", "echo"];
  try {
    await runStages(ids, base.id + gen, (sid) => useChrono.getState().patchSpecimen(artifactOf[sid] ?? {}), opts?.signal);
    useChrono.getState().patchSpecimen({ generation: gen, controls });
  } finally {
    useChrono.getState().setMode("idle", null);
  }
  return useChrono.getState().specimen!;
}
