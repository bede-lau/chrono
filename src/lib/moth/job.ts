/**
 * runJob — submit an Atlas job, poll it to completion, retry transient failures. Isomorphic.
 *
 * Polling: 1 s, backing off ×1.3 per poll up to 3 s.
 * Retries: failed jobs with `error.retryable` or a known transient type (engine_timeout, …), and transient HTTP
 * errors on submit (429/5xx/network), are resubmitted after 5, 10, 20, 40, 60 s (≤ maxAttempts, default 6).
 * The per-attempt poll timeout defaults to 40 min for tessa-image-v1 (hackathon queue) and 6 min otherwise.
 */
import { MothError, RETRYABLE_JOB_ERRORS, abortError, isAbortError } from "./errors";
import type { MothJobResult, MothJobStatus, MothTransport } from "./transport";

export type JobPhase = "submitting" | "queued" | "processing" | "completed" | "failed" | "retrying";

export interface JobEvent {
  engineId: string;
  phase: JobPhase;
  attempt: number; // 1-based
  maxAttempts: number;
  jobId?: string;
  status?: string; // raw Atlas status
  error?: string;
  errorType?: string;
  retryInMs?: number;
  elapsedMs: number; // since this attempt was submitted (or since run start while submitting)
}

export interface RunJobOptions {
  onStatus?: (e: JobEvent) => void;
  signal?: AbortSignal;
  maxAttempts?: number;
  /** Poll timeout per attempt (ms). */
  timeoutMs?: number;
  /** Backoff schedule between attempts (ms). */
  backoffMs?: number[];
  /** Resubmit when the local poll timeout elapses (default false: throw `client_timeout`). */
  retryOnTimeout?: boolean;
}

export interface JobAttemptLog {
  attempt: number;
  jobId?: string;
  outcome: "completed" | "failed" | "submit_error" | "client_timeout";
  errorType?: string;
  error?: string;
  latencyMs: number;
}

export interface JobOutcome {
  engineId: string;
  jobId: string;
  attempt: number; // attempt that succeeded (1-based)
  /** Wall-clock submit -> completed of the successful attempt. */
  latencyMs: number;
  /** Wall-clock from the first submit to the result, including retries/backoff. */
  totalMs: number;
  submittedAt: number;
  completedAt: number;
  status: MothJobStatus;
  result: MothJobResult;
  attempts: JobAttemptLog[];
}

export const DEFAULT_BACKOFF_MS = [5_000, 10_000, 20_000, 40_000, 60_000];
const SLOW_ENGINES: Record<string, number> = { "tessa-image-v1": 40 * 60_000 };

export function defaultTimeoutMs(engineId: string): number {
  return SLOW_ENGINES[engineId] ?? 6 * 60_000;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Human-readable reason from a failed job status. */
function jobErrorText(st: MothJobStatus): string {
  const e = st.error;
  if (!e) return "job failed";
  return [e.type, e.message].filter(Boolean).join(": ") || "job failed";
}

export async function runJob(
  transport: MothTransport,
  engineId: string,
  body: { input_files?: Record<string, string>; params?: Record<string, unknown> },
  opts: RunJobOptions = {},
): Promise<JobOutcome> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 6);
  const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs(engineId);
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const { signal } = opts;
  const t0 = Date.now();
  const attempts: JobAttemptLog[] = [];
  const emit = (e: Omit<JobEvent, "engineId" | "maxAttempts">) => {
    try {
      opts.onStatus?.({ engineId, maxAttempts, ...e });
    } catch {
      /* reporter errors must never break the chain */
    }
  };

  let lastErr: MothError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw abortError();
    if (attempt > 1) {
      const wait = backoff[Math.min(attempt - 2, backoff.length - 1)] ?? 60_000;
      emit({ phase: "retrying", attempt, error: lastErr?.message, errorType: lastErr?.type, retryInMs: wait, elapsedMs: Date.now() - t0 });
      await sleep(wait, signal);
    }

    // ---- submit
    emit({ phase: "submitting", attempt, elapsedMs: Date.now() - t0 });
    let jobId: string;
    const submittedAt = Date.now();
    try {
      jobId = await transport.submit(engineId, body);
    } catch (e) {
      if (isAbortError(e) || signal?.aborted) throw abortError();
      const err = e instanceof MothError ? e : new MothError({ status: 0, type: "network_error", message: String((e as Error)?.message ?? e), retryable: true });
      attempts.push({ attempt, outcome: "submit_error", errorType: err.type, error: err.message, latencyMs: Date.now() - submittedAt });
      lastErr = err;
      if (!err.retryable || attempt === maxAttempts) {
        emit({ phase: "failed", attempt, error: err.message, errorType: err.type, elapsedMs: Date.now() - t0 });
        throw err;
      }
      continue;
    }

    // ---- poll
    let interval = 1000;
    let consecutivePollErrors = 0;
    let lastPhase: JobPhase | undefined;
    let final: MothJobStatus | undefined;
    for (;;) {
      if (signal?.aborted) throw abortError();
      const elapsed = Date.now() - submittedAt;
      if (elapsed > timeoutMs) break;
      await sleep(interval, signal);
      interval = Math.min(3000, Math.round(interval * 1.3));
      let st: MothJobStatus;
      try {
        st = await transport.status(jobId);
        consecutivePollErrors = 0;
      } catch (e) {
        if (isAbortError(e) || signal?.aborted) throw abortError();
        const err = e instanceof MothError ? e : undefined;
        if (err && !err.retryable) throw err; // 4xx on our own job id: give up
        if (++consecutivePollErrors >= 12) throw err ?? new MothError({ status: 0, type: "network_error", message: String(e) });
        interval = 3000;
        continue;
      }
      const s = String(st.status);
      if (s === "completed" || s === "failed" || s === "cancelled" || s === "canceled") {
        final = st;
        break;
      }
      const phase: JobPhase = s === "queued" || s === "pending" ? "queued" : "processing";
      if (phase !== lastPhase || interval >= 3000) {
        emit({ phase, attempt, jobId, status: s, elapsedMs: Date.now() - submittedAt });
        lastPhase = phase;
      }
    }

    if (!final) {
      const err = new MothError({
        status: 0,
        type: "client_timeout",
        message: `${engineId} job ${jobId} still running after ${Math.round(timeoutMs / 1000)} s`,
        retryable: !!opts.retryOnTimeout,
        jobId,
        engineId,
      });
      attempts.push({ attempt, jobId, outcome: "client_timeout", errorType: err.type, error: err.message, latencyMs: Date.now() - submittedAt });
      lastErr = err;
      if (!err.retryable || attempt === maxAttempts) {
        emit({ phase: "failed", attempt, jobId, error: err.message, errorType: err.type, elapsedMs: Date.now() - submittedAt });
        throw err;
      }
      continue;
    }

    if (final.status === "completed") {
      const completedAt = Date.now();
      emit({ phase: "completed", attempt, jobId, status: "completed", elapsedMs: completedAt - submittedAt });
      let result: MothJobResult | undefined;
      for (let i = 0; i < 4; i++) {
        try {
          result = await transport.result(jobId);
          break;
        } catch (e) {
          if (isAbortError(e) || signal?.aborted) throw abortError();
          if (i === 3 || (e instanceof MothError && !e.retryable)) throw e;
          await sleep(1000 * (i + 1), signal);
        }
      }
      attempts.push({ attempt, jobId, outcome: "completed", latencyMs: completedAt - submittedAt });
      return {
        engineId,
        jobId,
        attempt,
        latencyMs: completedAt - submittedAt,
        totalMs: Date.now() - t0,
        submittedAt,
        completedAt,
        status: final,
        result: result!,
        attempts,
      };
    }

    // failed
    const type = final.error?.type ?? "job_failed";
    const retryable = final.error?.retryable === true || RETRYABLE_JOB_ERRORS.has(type);
    const err = new MothError({ status: 200, type, message: `${engineId}: ${jobErrorText(final)}`, retryable, jobId, engineId });
    attempts.push({ attempt, jobId, outcome: "failed", errorType: type, error: final.error?.message, latencyMs: Date.now() - submittedAt });
    lastErr = err;
    emit({ phase: "failed", attempt, jobId, status: String(final.status), error: err.message, errorType: type, elapsedMs: Date.now() - submittedAt });
    if (!retryable || attempt === maxAttempts) throw err;
  }

  throw lastErr ?? new MothError({ status: 0, type: "exhausted", message: `${engineId}: retries exhausted` });
}
