/** Pure local experiment math; no rendering, audio, or network side effects. */
import type { RhythmState } from "./chain/types";

export const freshRhythm = (bpm = 90): RhythmState => ({ at: 0, taps: 0, streak: 0, accuracy: null, bpm });
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0));

/** Score consecutive taps against the chosen tempo. Ignore key bounce / rapid repeat. */
export function nextRhythm(previous: RhythmState, now: number): RhythmState {
  if (!Number.isFinite(now) || now <= previous.at || (previous.at > 0 && now - previous.at < 120)) return previous;
  const interval = 60_000 / previous.bpm;
  const elapsed = now - previous.at;
  const accuracy = previous.at > 0 && elapsed < interval * 2.5
    ? clamp(1 - Math.abs(elapsed - interval) / (interval * 0.4), 0, 1) : null;
  return { ...previous, at: now, taps: previous.taps + 1, accuracy, streak: accuracy !== null && accuracy >= 0.65 ? previous.streak + 1 : 0 };
}

/** Exact damped spring, stable even across a throttled frame; no numerical integration drift. */
export function springStep(position: number, velocity: number, target: number, dt: number, omega = 16, damping = 0.55): [number, number] {
  const t = clamp(dt, 0, 0.1), z = clamp(damping, 0.05, 0.99), w = omega * Math.sqrt(1 - z * z);
  const y = position - target, b = (velocity + z * omega * y) / w;
  const decay = Math.exp(-z * omega * t), c = Math.cos(w * t), s = Math.sin(w * t);
  return [target + decay * (y * c + b * s), decay * (velocity * c - (z * omega * b + y * w) * s)];
}
