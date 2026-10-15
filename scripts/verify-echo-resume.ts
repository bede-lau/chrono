/**
 * Regression coverage for Echo jobs that survive a local client failure.
 *
 * Run: npx tsx scripts/verify-echo-resume.ts
 *
 * No Moth credentials or network calls. The scenarios exercise the actual pipeline failure path,
 * then prove a resume polls/fetches the same remote job without another Atlas submission.
 */
import assert from "node:assert/strict";
import { ChainHaltedError, resumeChain, type ArtifactSink } from "../src/lib/chain/pipeline";
import { defaultTimeoutMs } from "../src/lib/moth/job";
import { MothError } from "../src/lib/moth/errors";
import { DEFAULT_CONTROLS, STAGES, type Specimen, type StageRun } from "../src/lib/chain/types";
import type { MothJobResult, MothJobStatus, MothOutput, MothTransport } from "../src/lib/moth/transport";

function wav(): Uint8Array {
  const bytes = new Uint8Array(48);
  const v = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  v.setUint32(4, 40, true);
  bytes.set(new TextEncoder().encode("WAVEfmt "), 8);
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8_000, true);
  v.setUint32(28, 16_000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  bytes.set(new TextEncoder().encode("data"), 36);
  v.setUint32(40, 4, true);
  return bytes;
}

const output: MothOutput = {
  slot: "result",
  content_type: "audio/wav",
  size_bytes: 48,
  output_asset_id: "echo-output",
  filename: "echo.wav",
};

function specimen(echo: Partial<StageRun> = {}): Specimen {
  return {
    id: "resume-fixture",
    name: "Resume fixture",
    createdAt: new Date(0).toISOString(),
    generation: 0,
    controls: DEFAULT_CONTROLS,
    wounds: [],
    metrics: { entropy: 4.2, qubitsUsed: 8 },
    colony: { numQubits: 8, bloch: [], correlations: [], dominant: "", seed: { url: "memory:seed", width: 1, height: 1 } },
    voice: { url: "memory:voice", assetId: "voice-output", durationSec: 1 },
    runs: Object.fromEntries(
      STAGES.map((stage) => [
        stage.id,
        stage.id === "echo" ? { id: stage.id, status: "idle" as const, attempt: 0, ...echo } : { id: stage.id, status: "done" as const, attempt: 1 },
      ]),
    ) as Specimen["runs"],
  };
}

function sink(): ArtifactSink {
  return {
    write: async (_id, name) => `memory:${name}`,
    read: async () => wav(),
  };
}

function options(extra: Record<string, unknown> = {}) {
  return {
    jobOptions: {
      // A one-millisecond test budget reaches the same local-timeout branch after one mock poll.
      "retrocausal-echo-v1": { timeoutMs: 1, ...extra },
    },
  };
}

async function halted(run: Promise<Specimen>): Promise<Specimen> {
  try {
    await run;
  } catch (e) {
    assert.ok(e instanceof ChainHaltedError, `expected ChainHaltedError, got ${String(e)}`);
    return e.specimen;
  }
  assert.fail("expected the chain to halt");
}

function remoteTransport(handlers: {
  status: (jobId: string) => Promise<MothJobStatus>;
  result?: () => Promise<MothJobResult>;
  download?: () => Promise<Uint8Array>;
}) {
  let submits = 0;
  const submitted: string[] = [];
  const statuses: string[] = [];
  const transport: MothTransport = {
    uploadAsset: async () => "unused",
    submit: async () => {
      submits++;
      const id = `echo-submission-${submits}`;
      submitted.push(id);
      return id;
    },
    status: async (jobId) => {
      statuses.push(jobId);
      return handlers.status(jobId);
    },
    result: async () => handlers.result?.() ?? { outputs: [output] },
    download: async () => handlers.download?.() ?? wav(),
  };
  return { transport, submitted, statuses, submits: () => submits };
}

assert.equal(defaultTimeoutMs("retrocausal-echo-v1"), 20 * 60_000, "Echo keeps a 20-minute first polling budget");

// 1. Reproduce the user's exact condition: the remote Echo remains queued after the local poll budget.
let phase: "queued" | "completed" = "queued";
const timeoutCase = remoteTransport({
  status: async (jobId) => ({ job_id: jobId, engine_id: "retrocausal-echo-v1", status: phase }),
});
const partial = await halted(resumeChain({ transport: timeoutCase.transport, sink: sink() }, specimen(), options()));
const timedOut = partial.runs.echo;
assert.ok(timedOut);
assert.equal(timeoutCase.submits(), 1, "the original Echo submits exactly once");
assert.equal(timedOut.status, "failed");
assert.equal(timedOut.errorType, "client_timeout", "a local timeout is retained as a recoverable remote job");
assert.equal(timedOut.jobId, "echo-submission-1");
const completedRuns = STAGES.slice(0, -1).map((stage) => partial.runs[stage.id]);
const initialElapsed = timedOut.finishedAt! - timedOut.startedAt!;

phase = "completed";
const resumed = await resumeChain({ transport: timeoutCase.transport, sink: sink() }, partial, options());
const resumedEcho = resumed.runs.echo;
assert.ok(resumedEcho);
assert.equal(timeoutCase.submits(), 1, "resume polls the paid job instead of submitting a duplicate");
assert.ok(timeoutCase.statuses.every((id) => id === "echo-submission-1"));
assert.equal(resumedEcho.status, "done");
assert.equal(resumedEcho.errorType, undefined);
assert.equal(resumedEcho.jobId, "echo-submission-1");
assert.ok(resumedEcho.latencyMs! > initialElapsed + 500, "completion latency retains the original attempt's elapsed time");
assert.deepEqual(
  STAGES.slice(0, -1).map((stage) => resumed.runs[stage.id]),
  completedRuns,
  "the seven completed stages remain cached in place and are never rerun",
);

// 2. A network outage while polling preserves the known remote job instead of treating it as a failed engine.
let networkOnline = false;
const pollCase = remoteTransport({
  status: async (jobId) => {
    if (!networkOnline) throw new MothError({ status: 0, type: "network_error", message: "offline", retryable: true });
    return { job_id: jobId, engine_id: "retrocausal-echo-v1", status: "completed" };
  },
});
const pollPartial = await halted(resumeChain({ transport: pollCase.transport, sink: sink() }, specimen(), options({ maxConsecutivePollErrors: 1 })));
assert.equal(pollPartial.runs.echo?.errorType, "poll_unavailable");
networkOnline = true;
const pollResumed = await resumeChain({ transport: pollCase.transport, sink: sink() }, pollPartial, options());
assert.equal(pollCase.submits(), 1, "poll recovery does not create a second Echo job");
assert.equal(pollResumed.runs.echo?.jobId, "echo-submission-1");

// 3. Atlas can say completed while its result endpoint is briefly unavailable. Re-fetch the result from the same job.
let resultAvailable = false;
const resultCase = remoteTransport({
  status: async (jobId) => ({ job_id: jobId, engine_id: "retrocausal-echo-v1", status: "completed" }),
  result: async () => {
    if (!resultAvailable) throw new MothError({ status: 503, type: "network_error", message: "result gateway unavailable", retryable: true });
    return { outputs: [output] };
  },
});
const resultPartial = await halted(resumeChain({ transport: resultCase.transport, sink: sink() }, specimen(), options({ maxResultAttempts: 1 })));
assert.equal(resultPartial.runs.echo?.errorType, "result_unavailable");
resultAvailable = true;
const resultResumed = await resumeChain({ transport: resultCase.transport, sink: sink() }, resultPartial, options());
assert.equal(resultCase.submits(), 1, "result recovery does not re-run Echo");
assert.equal(resultResumed.echo?.assetId, "echo-output");

// 4. A signed-output/network download failure also retains the completed job for a result refresh, not a duplicate run.
let downloads = 0;
const downloadCase = remoteTransport({
  status: async (jobId) => ({ job_id: jobId, engine_id: "retrocausal-echo-v1", status: "completed" }),
  download: async () => {
    downloads++;
    if (downloads <= 3) throw new MothError({ status: 503, type: "network_error", message: "asset gateway unavailable", retryable: true });
    return wav();
  },
});
const downloadPartial = await halted(resumeChain({ transport: downloadCase.transport, sink: sink() }, specimen(), options()));
assert.equal(downloadPartial.runs.echo?.errorType, "output_unavailable");
const downloadResumed = await resumeChain({ transport: downloadCase.transport, sink: sink() }, downloadPartial, options());
assert.equal(downloadCase.submits(), 1, "download recovery does not re-run Echo");
assert.equal(downloadResumed.echo?.assetId, "echo-output");

// 5. Stop only cancels the local wait. Once the job id has been received, Stop → Resume also keeps it.
let stoppedPhase: "queued" | "completed" = "queued";
const stopCase = remoteTransport({
  status: async (jobId) => ({ job_id: jobId, engine_id: "retrocausal-echo-v1", status: stoppedPhase }),
});
let stoppedPartial: Specimen | null = null;
const capturedStop = (): Specimen => {
  if (!stoppedPartial) throw new Error("stop reporter did not retain a partial specimen");
  return stoppedPartial;
};
const stoppedReporter = {
  setSpecimen: (next: Specimen) => {
    stoppedPartial = structuredClone(next);
  },
  setRun: (id: keyof Specimen["runs"], patch: Partial<StageRun>) => {
    assert.ok(stoppedPartial);
    const previous = stoppedPartial.runs[id] ?? { id, status: "idle", attempt: 0 };
    stoppedPartial.runs[id] = { ...previous, ...patch, id };
  },
};
const stopController = new AbortController();
const stoppedPromise = resumeChain(
  { transport: stopCase.transport, sink: sink(), reporter: stoppedReporter },
  specimen(),
  { ...options(), signal: stopController.signal },
);
setTimeout(() => stopController.abort(), 25);
await assert.rejects(stoppedPromise, (e: unknown) => (e as { name?: string }).name === "AbortError");
assert.equal(capturedStop().runs.echo?.errorType, "client_aborted");
assert.equal(capturedStop().runs.echo?.jobId, "echo-submission-1");
stoppedPhase = "completed";
const stoppedResumed = await resumeChain({ transport: stopCase.transport, sink: sink() }, capturedStop(), options());
assert.equal(stopCase.submits(), 1, "Stop → Resume polls the original Echo job");
assert.equal(stoppedResumed.runs.echo?.status, "done");

// 6. A terminal engine failure is intentionally different: the old job is not polled and a new attempt is submitted.
const terminalCase = remoteTransport({
  status: async (jobId) => ({ job_id: jobId, engine_id: "retrocausal-echo-v1", status: "completed" }),
});
const terminal = specimen({ status: "failed", attempt: 1, jobId: "echo-terminal", errorType: "engine_timeout", error: "worker timed out" });
const terminalResumed = await resumeChain({ transport: terminalCase.transport, sink: sink() }, terminal, options());
assert.deepEqual(terminalCase.submitted, ["echo-submission-1"], "terminal failure deliberately starts a new submission");
assert.ok(!terminalCase.statuses.includes("echo-terminal"));
assert.equal(terminalResumed.runs.echo?.status, "done");

console.log("echo resume regression: passed (timeout, poll/result/download recovery, and terminal retry policy)");
