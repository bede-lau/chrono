/**
 * Chrono Lens animator: turns the shared `lens` state (+ viewport-internal reveal pulses) into eased per-stage amounts
 * for the two halves of the compare wipe, and eased overlay opacities. Pure, allocation-free per frame.
 * OWNER: viewport agent.
 *
 *   L[i] = stage i's amount on the "without" half (left), R[i] = on the "with" half (right); compare off => only R is seen.
 *   ov[i] = overlay opacity of stage i.
 */
import type { LensState, StageId, StageStatus } from "@/lib/chain/types";

export const STAGE_ORDER: readonly StageId[] = ["genesis", "colony", "morphogenesis", "decoherence", "soma", "membrane", "voice", "echo"];
export const STAGE_INDEX: Record<StageId, number> = {
  genesis: 0,
  colony: 1,
  morphogenesis: 2,
  decoherence: 3,
  soma: 4,
  membrane: 5,
  voice: 6,
  echo: 7,
};

const TAU_LENS = 0.25; // lens amount easing (spec: τ ≈ 0.25 s)
const TAU_OVERLAY = 0.2;
const TAU_COMPARE = 0.22;
const TAU_REVEAL = 0.1;
export const REVEAL_S = 2.2;
const PENDING_MAX_S = 3;

const IN_PROGRESS: ReadonlySet<StageStatus> = new Set<StageStatus>(["queued", "uploading", "running", "retrying"]);

const k = (dt: number, tau: number) => 1 - Math.exp(-dt / tau);
const clamp01 = (x: number) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

export class LensAnimator {
  readonly L = new Float32Array(8).fill(1);
  readonly R = new Float32Array(8).fill(1);
  readonly ov = new Float32Array(8);
  /** 0..1 eased compare wipe. */
  compare = 0;
  /** Stage whose reveal pulse is playing (-1 = none) and its progress in seconds. */
  reveal = -1;
  revealT = 0;

  private readonly tL = new Float32Array(8);
  private readonly tR = new Float32Array(8);
  private readonly tOv = new Float32Array(8);
  private readonly prevStatus: StageStatus[] = Array(8).fill("idle");
  private pending = -1;
  private pendingAge = 0;

  /**
   * Watch the run statuses: a stage that goes from in-progress to "done" (never "cached", never an archive load)
   * requests a reveal pulse. Stale transitions (tab was hidden) are ignored.
   */
  watchRuns(runs: Partial<Record<StageId, { status: StageStatus; finishedAt?: number }>>, nowMs: number) {
    for (let i = 0; i < 8; i++) {
      const r = runs[STAGE_ORDER[i]];
      const status = r?.status ?? "idle";
      const prev = this.prevStatus[i];
      if (status === prev) continue;
      this.prevStatus[i] = status;
      if (status === "done" && IN_PROGRESS.has(prev) && (!r?.finishedAt || nowMs - r.finishedAt < 4000)) {
        this.pending = i;
        this.pendingAge = 0;
      }
    }
  }

  /** Start a reveal now (lab / tests). */
  playReveal(i: number) {
    this.pending = i;
    this.pendingAge = 0;
  }

  cancelReveal() {
    this.pending = -1;
    this.reveal = -1;
  }

  resetRuns() {
    this.prevStatus.fill("idle");
    this.cancelReveal();
  }

  update(dt: number, lens: LensState, has: boolean, dragging: boolean) {
    const { tL, tR, tOv } = this;
    tL.fill(1);
    tR.fill(1);
    tOv.fill(0);
    let cmp = 0;
    const x = has && lens.stage ? STAGE_INDEX[lens.stage] : -1;
    if (x >= 0) {
      tR[x] = clamp01(lens.amount);
      tL[x] = 0;
      if (lens.overlay) tOv[x] = 1;
      cmp = lens.compare ? 1 : 0;
      // focus: a colour stage hides the downstream colour stages that would paint over it, and quietens the film
      if (x === 1) {
        tL[2] = tR[2] = 0;
        tL[3] = tR[3] = 0;
        tL[5] = tR[5] = 0.35;
      } else if (x === 2) {
        tL[3] = tR[3] = 0;
        tL[5] = tR[5] = 0.35;
      } else if (x === 3) {
        tL[5] = tR[5] = 0.5;
      }
    }

    // reveal pulse: never while the user drags/orbits (deferred, then dropped if stale)
    if (this.pending >= 0) {
      this.pendingAge += dt;
      if (this.pendingAge > PENDING_MAX_S) this.pending = -1;
      else if (!dragging && has) {
        this.reveal = this.pending;
        this.revealT = 0;
        this.pending = -1;
      }
    }
    if (this.reveal >= 0 && (dragging || !has)) this.reveal = -1;
    if (this.reveal >= 0) {
      this.revealT += dt;
      const p = this.revealT;
      const r = this.reveal;
      const amt = p < 0.35 ? 0 : smooth((p - 0.35) / 1.25);
      const o = p < 1.45 ? 1 : 1 - smooth((p - 1.45) / (REVEAL_S - 1.45));
      tL[r] = tR[r] = amt;
      tOv[r] = Math.max(tOv[r], o);
      if (p >= REVEAL_S) this.reveal = -1;
    }

    const kl = k(dt, TAU_LENS);
    const kr = k(dt, TAU_REVEAL);
    const ko = k(dt, TAU_OVERLAY);
    for (let i = 0; i < 8; i++) {
      const kk = i === this.reveal ? kr : kl;
      this.L[i] += (tL[i] - this.L[i]) * kk;
      this.R[i] += (tR[i] - this.R[i]) * kk;
      this.ov[i] += (tOv[i] - this.ov[i]) * (i === this.reveal ? kr : ko);
    }
    this.compare += (cmp - this.compare) * k(dt, TAU_COMPARE);
  }
}
