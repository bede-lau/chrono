/**
 * Offline regression coverage for Tessa's bounded Morphogenesis policy.
 *
 * Run: npx tsx scripts/verify-morphogenesis.ts
 *
 * This uses the actual chain with a mock transport. It never contacts Atlas.
 */
import assert from "node:assert/strict";
import { encodePng } from "../src/lib/imaging";
import { ChainHaltedError, growChain, resumeChain, type ArtifactSink } from "../src/lib/chain/pipeline";
import { defaultTimeoutMs } from "../src/lib/moth/job";
import { MothError } from "../src/lib/moth/errors";
import { DEFAULT_CONTROLS, type Specimen } from "../src/lib/chain/types";
import type { MothJobResult, MothJobStatus, MothOutput, MothTransport } from "../src/lib/moth/transport";

const skin = encodePng({
  width: 2,
  height: 2,
  data: new Uint8ClampedArray([
    255, 64, 32, 255, 32, 255, 64, 255,
    64, 32, 255, 255, 255, 220, 32, 255,
  ]),
});

function sink(): ArtifactSink {
  const files = new Map<string, Uint8Array>();
  return {
    write: async (id, name, bytes) => {
      const url = `memory:${id}/${name}`;
      files.set(url, bytes);
      return url;
    },
    read: async (url) => {
      const bytes = files.get(url);
      if (!bytes) throw new Error(`missing fixture ${url}`);
      return bytes;
    },
  };
}

type TessaMode = "terminal" | "complete" | "first-terminal" | "pending" | "submit-timeout";

function mockTransport(mode: { value: TessaMode }) {
  const submitted: { engine: string; body: { input_files?: Record<string, string>; params?: Record<string, unknown> }; job: string }[] = [];
  const submitAttempts: string[] = [];
  const jobs = new Map<string, string>();
  let uploads = 0;
  let tessaPolls = 0;
  const transport: MothTransport = {
    uploadAsset: async () => `asset-${++uploads}`,
    submit: async (engine, body) => {
      submitAttempts.push(engine);
      if (engine === "tessa-image-v1" && mode.value === "submit-timeout") {
        throw new MothError({ status: 504, type: "engine_timeout", message: "submit gateway timeout", retryable: true });
      }
      const job = `${engine}-${submitted.length + 1}`;
      submitted.push({ engine, body, job });
      jobs.set(job, engine);
      return job;
    },
    status: async (job): Promise<MothJobStatus> => {
      const engine = jobs.get(job) ?? (job.startsWith("tessa-image-v1") ? "tessa-image-v1" : "unknown");
      if (engine === "tessa-image-v1" && mode.value === "terminal") {
        return { job_id: job, engine_id: engine, status: "failed", error: { type: "engine_timeout", message: "worker limit", retryable: true } };
      }
      if (engine === "tessa-image-v1" && mode.value === "first-terminal") {
        tessaPolls++;
        if (tessaPolls === 1) {
          await new Promise((resolve) => setTimeout(resolve, 15));
          return { job_id: job, engine_id: engine, status: "failed", error: { type: "engine_timeout", message: "worker limit", retryable: true } };
        }
      }
      if (engine === "tessa-image-v1" && mode.value === "pending") return { job_id: job, engine_id: engine, status: "queued" };
      if (engine === "blur-v1") {
        return { job_id: job, engine_id: engine, status: "failed", error: { type: "bad_fixture", message: "stop after Tessa", retryable: false } };
      }
      return { job_id: job, engine_id: engine, status: "completed" };
    },
    result: async (job): Promise<MothJobResult> => {
      const engine = jobs.get(job) ?? "tessa-image-v1";
      if (engine === "comet-qrng-v1") return { result: { output: { random: { hex: "01".repeat(32) } } } };
      if (engine === "graph-v1") {
        const n = 7;
        return {
          result: {
            output: {
              dominant_bitstring: "0".repeat(n),
              tomography: {
                bloch: Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i), { X: i % 2 ? -0.4 : 0.4, Y: 0.2, Z: 0.7 }])),
                relationships: {},
              },
            },
          },
        };
      }
      const output: MothOutput = { slot: "result", content_type: "image/png", size_bytes: skin.byteLength, output_asset_id: "skin-output", filename: "skin.png" };
      return { outputs: [output] };
    },
    download: async () => skin,
  };
  return { transport, submitted, submitAttempts, uploads: () => uploads };
}

async function halted(run: Promise<Specimen>) {
  try {
    await run;
  } catch (e) {
    assert.ok(e instanceof ChainHaltedError, `expected ChainHaltedError, got ${String(e)}`);
    return e.specimen;
  }
  assert.fail("expected a halted chain");
}

assert.equal(defaultTimeoutMs("tessa-image-v1"), 90_000, "Tessa has a bounded 90-second local polling window");
assert.equal(defaultTimeoutMs("retrocausal-echo-v1"), 20 * 60_000, "Echo retains its separate recovery window");

const mode = { value: "terminal" as TessaMode };
const first = mockTransport(mode);
const sharedSink = sink();
const partial = await halted(growChain({ transport: first.transport, sink: sharedSink }, DEFAULT_CONTROLS));
const tessa = first.submitted.filter((x) => x.engine === "tessa-image-v1");
assert.equal(tessa.length, 2, "Tessa performs one smaller fallback, never the generic six identical retries");
assert.deepEqual(tessa.map((x) => x.body.params), [{ machine: "aer", shots: 128 }, { machine: "aer", shots: 64 }]);
assert.equal(tessa[0].body.input_files?.image, tessa[1].body.input_files?.image, "fallback reuses the uploaded compact input");
assert.equal(first.uploads(), 1, "the compact input uploads once");
const failed = partial.runs.morphogenesis!;
assert.equal(failed.status, "failed");
assert.equal(failed.attempt, 2, "attempt accounting includes the fallback");
assert.equal(failed.maxAttempts, 2, "the UI reports the bounded two-attempt stage policy");
assert.deepEqual(failed.params, { machine: "aer", shots: 64 });
assert.equal(failed.inputImage?.width, 16);
assert.equal(failed.inputImage?.height, 16);
assert.equal(partial.colony?.seed.width, 32, "the archival Colony seed remains 32×32");
assert.equal(partial.runs.genesis?.status, "done");
assert.equal(partial.runs.colony?.status, "done");

// A terminal retry stays on the already reduced 64-shot workload and preserves the early chain.
mode.value = "complete";
const beforeManualRetry = first.submitted.filter((x) => x.engine === "tessa-image-v1").length;
const manuallyRetried = await halted(resumeChain({ transport: first.transport, sink: sharedSink }, partial));
const manualTessa = first.submitted.filter((x) => x.engine === "tessa-image-v1");
assert.equal(manualTessa.length, beforeManualRetry + 1, "manual retry makes one new Tessa submission");
assert.deepEqual(manualTessa.at(-1)?.body.params, { machine: "aer", shots: 64 }, "manual retry keeps the reduced workload");
assert.equal(manuallyRetried.runs.morphogenesis?.status, "done");
assert.equal(manuallyRetried.runs.genesis?.status, "done");
assert.equal(manuallyRetried.runs.colony?.status, "done");

// A local timeout after the fallback resumes the known Atlas job and sends no third request.
const pending = structuredClone(partial);
pending.runs.morphogenesis = {
  ...pending.runs.morphogenesis!,
  status: "failed",
  errorType: "client_timeout",
  error: "local polling window expired",
  jobId: tessa[1].job,
  attempt: 2,
  maxAttempts: 2,
  params: { machine: "aer", shots: 64 },
};
const resumed = await halted(resumeChain({ transport: first.transport, sink: sharedSink }, pending));
assert.equal(first.submitted.filter((x) => x.engine === "tessa-image-v1").length, manualTessa.length, "resume polls the paid fallback job without submitting another Tessa request");
assert.equal(resumed.runs.morphogenesis?.status, "done");
assert.equal(resumed.runs.morphogenesis?.attempt, 2);
assert.equal(resumed.runs.morphogenesis?.maxAttempts, 2);
assert.deepEqual(resumed.runs.morphogenesis?.params, { machine: "aer", shots: 64 });

// A successful fallback reports the whole stage wait, including the failed 128-shot attempt.
const fallbackSuccess = mockTransport({ value: "first-terminal" });
const fallbackSpecimen = await halted(growChain({ transport: fallbackSuccess.transport, sink: sink() }, DEFAULT_CONTROLS));
assert.equal(fallbackSpecimen.runs.morphogenesis?.status, "done");
// Each real poll loop waits at least one second. Reporting only the successful job would be ~1 s.
assert.ok((fallbackSpecimen.runs.morphogenesis?.latencyMs ?? 0) >= 2_000, "Morphogenesis elapsed time includes both one-second attempts");

// Unknown local/network conditions never cause an automatic duplicate submission. The existing
// job remains resumable instead of assuming that Atlas stopped it.
const pendingMode = { value: "pending" as TessaMode };
const localTimeout = mockTransport(pendingMode);
const localPartial = await halted(growChain(
  { transport: localTimeout.transport, sink: sink() },
  DEFAULT_CONTROLS,
  { jobOptions: { "tessa-image-v1": { timeoutMs: 1 } } },
));
assert.equal(localTimeout.submitted.filter((x) => x.engine === "tessa-image-v1").length, 1, "client timeout does not trigger the 64-shot fallback");
assert.equal(localPartial.runs.morphogenesis?.errorType, "client_timeout");

const submitTimeout = mockTransport({ value: "submit-timeout" });
const submitPartial = await halted(growChain({ transport: submitTimeout.transport, sink: sink() }, DEFAULT_CONTROLS));
assert.equal(submitTimeout.submitAttempts.filter((engine) => engine === "tessa-image-v1").length, 1, "a submit timeout does not trigger a second Tessa request");
assert.equal(submitPartial.runs.morphogenesis?.errorType, "engine_timeout");

console.log("Morphogenesis bounded retry and resume checks passed.");
