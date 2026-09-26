/**
 * synth.ts — OWNER: audio agent.
 * Pure, isomorphic (Node via tsx + browser; no Buffer/DOM). Deterministic.
 *
 * Voices the membrane's reflectance/transmittance LUTs + soma displacement field into a short
 * vocabulary of drone chunks for qrc-audio-v1. Musical intent: an eerie, beautiful, slowly
 * breathing microtonal drone of a living organism — not harsh noise.
 *
 *  - Base pitch (55-110 Hz) comes from the genome, shared across the whole vocabulary so the
 *    organism has one stable "fundamental identity".
 *  - Each chunk is voiced from one angle-row of the R LUT (t = incidence angle, row 0 = theta 0):
 *    local maxima ("peaks") along the periodic phase axis pick 4-7 microtonal partial ratios
 *    (continuous function of peak position, not quantised to equal temperament).
 *  - Each partial's amplitude is shaped by how reflective vs transmissive the LUT is at that
 *    peak (R vs T), plus a gentle harmonic rolloff.
 *  - Each partial gets 2 detuned "chorus" companions (a few cents apart) for a living, unstable
 *    beating quality instead of a sterile pure tone.
 *  - A slow amplitude LFO ("breathing"), soft raised-cosine attack/release (click-free looping /
 *    crossfading), and sparse soft filtered-noise "cellular clicks" (placed at soma grid peaks)
 *    round out the texture.
 *  - Every chunk is DC-removed and peak-normalised to -3 dBFS.
 */
import type { GenomeArtifact, Lut, MembraneArtifact, SomaArtifact } from "../chain/types";
import { encodeWav } from "./wav";

const TARGET_PEAK = Math.pow(10, -3 / 20); // -3 dBFS ≈ 0.70795

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) + a small seed-derivation helper.
// ---------------------------------------------------------------------------

function fnv1a(bytes: readonly number[]): number {
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function next() {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function uint32FromBytes(bytes: readonly number[]): number {
  return (((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0)) >>> 0;
}

// ---------------------------------------------------------------------------
// LUT peak-picking: find local maxima along a periodic row, sorted by height.
// ---------------------------------------------------------------------------

interface Peak {
  idx: number;
  value: number;
}

function rowOf(lut: Lut, row: number): Float64Array {
  const clampedRow = Math.max(0, Math.min(lut.height - 1, row));
  const start = clampedRow * lut.width;
  const out = new Float64Array(lut.width);
  for (let i = 0; i < lut.width; i++) out[i] = lut.data[start + i] ?? 0;
  return out;
}

/** Local maxima on a periodic (wrap-around) row, deduped, sorted descending by value. */
function findPeaks(row: Float64Array): Peak[] {
  const n = row.length;
  if (n === 0) return [];
  const candidates: Peak[] = [];
  for (let i = 0; i < n; i++) {
    const prev = row[(i - 1 + n) % n];
    const next = row[(i + 1) % n];
    const v = row[i];
    if (v >= prev && v >= next) candidates.push({ idx: i, value: v });
  }
  candidates.sort((a, b) => b.value - a.value);

  // Dedupe peaks that are within n/32 of an already-picked peak (avoid two near-identical ratios).
  const minGap = Math.max(1, Math.floor(n / 32));
  const picked: Peak[] = [];
  for (const c of candidates) {
    if (picked.every((p) => Math.min(Math.abs(p.idx - c.idx), n - Math.abs(p.idx - c.idx)) >= minGap)) {
      picked.push(c);
    }
  }
  return picked;
}

function pickPartialIndices(row: Float64Array, count: number): number[] {
  const n = row.length;
  const peaks = findPeaks(row);
  const idxs = peaks.slice(0, count).map((p) => p.idx);
  // Fallback: not enough distinct peaks (flat/uniform row) — fill evenly across the row.
  let k = 0;
  while (idxs.length < count && n > 0) {
    const candidate = Math.floor((k * n) / count);
    if (!idxs.includes(candidate)) idxs.push(candidate);
    k++;
    if (k > count * 4) break; // safety
  }
  return idxs;
}

/** Continuous (microtonal) frequency ratio from a LUT column position — not equal-tempered. */
function ratioFromPeak(idx: number, width: number, spreadOctaves: number): number {
  const frac = width > 0 ? (idx % width) / width : 0;
  return Math.pow(2, frac * spreadOctaves);
}

// ---------------------------------------------------------------------------
// Soma-grid peak-picking -> sparse "cellular click" placements across the whole vocabulary.
// ---------------------------------------------------------------------------

interface ClickEvent {
  chunkIndex: number;
  localTime: number; // seconds within the chunk
  strength: number; // 0..1
}

function findSomaClicks(soma: SomaArtifact, numChunks: number, chunkSeconds: number, maxClicks: number): ClickEvent[] {
  const n = soma.size;
  const grid = soma.grid;
  if (n <= 0 || grid.length < n * n) return [];

  let mean = 0;
  for (const v of grid) mean += v;
  mean /= grid.length;
  let variance = 0;
  for (const v of grid) variance += (v - mean) * (v - mean);
  variance /= grid.length;
  const std = Math.sqrt(variance);
  const threshold = mean + std * 0.75;

  const candidates: { idx: number; value: number }[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const idx = r * n + c;
      const v = grid[idx];
      if (v < threshold) continue;
      let isPeak = true;
      for (let dr = -1; dr <= 1 && isPeak; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
          if (grid[rr * n + cc] > v) {
            isPeak = false;
            break;
          }
        }
      }
      if (isPeak) candidates.push({ idx, value: v });
    }
  }
  candidates.sort((a, b) => b.value - a.value);
  const chosen = candidates.slice(0, maxClicks);

  const totalDuration = numChunks * chunkSeconds;
  return chosen.map((c) => {
    const globalT = (c.idx / (n * n)) * totalDuration;
    const chunkIndex = Math.min(numChunks - 1, Math.floor(globalT / chunkSeconds));
    const localTime = globalT - chunkIndex * chunkSeconds;
    return { chunkIndex, localTime, strength: Math.max(0.15, Math.min(1, c.value)) };
  });
}

/** Render a short, soft filtered-noise "cellular click" grain into `buf` starting at `startSample`. */
function renderClick(buf: Float64Array, startSample: number, sampleRate: number, strength: number, rand: () => number): void {
  const durSec = 0.02 + rand() * 0.025; // 20-45ms
  const n = Math.max(1, Math.round(durSec * sampleRate));
  const attackN = Math.max(1, Math.round(0.002 * sampleRate));
  let lp = 0;
  const a = 0.72 + rand() * 0.1; // one-pole lowpass coefficient — softens white noise into a "tick"
  const gain = 0.22 * strength;
  for (let i = 0; i < n; i++) {
    const white = rand() * 2 - 1;
    lp = a * lp + (1 - a) * white;
    const env = i < attackN ? i / attackN : Math.exp(-3 * ((i - attackN) / n));
    const s = startSample + i;
    if (s >= 0 && s < buf.length) buf[s] += lp * env * gain;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function synthesizeVocabulary(
  membrane: MembraneArtifact,
  soma: SomaArtifact,
  genome: GenomeArtifact,
  opts?: { chunks?: number; chunkSeconds?: number; sampleRate?: number },
): { name: string; wav: Uint8Array }[] {
  const numChunks = Math.max(8, Math.min(12, opts?.chunks ?? 10));
  const chunkSeconds = opts?.chunkSeconds ?? 1.0;
  const sampleRate = opts?.sampleRate ?? 22050;

  const rootSeed = fnv1a(genome.bytes);
  // Base frequency 55-110 Hz, spanning exactly one octave — reuse the same byte slice as the
  // Voice stage's engine seed (genome[8..11]) so the organism's pitch identity is consistent.
  const pitchSeed = uint32FromBytes(genome.bytes.slice(8, 12));
  const baseFreq = 55 * Math.pow(2, (pitchSeed % 100000) / 100000);

  const spreadOctaves = 1.4 + membrane.params.absorption; // ties timbre spread to membrane absorption
  const rtBalanceEps = 1e-4;

  const clicks = findSomaClicks(soma, numChunks, chunkSeconds, 8);
  const clicksByChunk = new Map<number, ClickEvent[]>();
  for (const c of clicks) {
    const list = clicksByChunk.get(c.chunkIndex) ?? [];
    list.push(c);
    clicksByChunk.set(c.chunkIndex, list);
  }

  const chunks: { name: string; wav: Uint8Array }[] = [];

  for (let chunkIndex = 0; chunkIndex < numChunks; chunkIndex++) {
    const chunkRand = mulberry32(rootSeed ^ Math.imul(chunkIndex + 1, 0x9e3779b1));
    const n = Math.max(1, Math.round(sampleRate * chunkSeconds));
    const buf = new Float64Array(n);

    // Which angle-row of the LUTs voices this chunk (spread across the full theta range).
    const rowFrac = numChunks > 1 ? chunkIndex / (numChunks - 1) : 0;
    const row = Math.round(rowFrac * (membrane.rLut.height - 1));
    const rRow = rowOf(membrane.rLut, row);
    const tRow = rowOf(membrane.tLut, row);

    const numPartials = 4 + Math.floor(chunkRand() * 4); // 4..7
    const partialIdxs = pickPartialIndices(rRow, numPartials);

    // Per-partial phase + chorus detune, all seeded deterministically.
    const partials = partialIdxs.map((idx, k) => {
      const ratio = ratioFromPeak(idx, membrane.rLut.width, spreadOctaves);
      const ampR = Math.max(0, rRow[idx] ?? 0);
      const ampT = Math.max(0, tRow[idx % tRow.length] ?? 0);
      const rtBalance = ampR / (ampR + ampT + rtBalanceEps); // 0 = fully transmissive, 1 = fully reflective
      const rolloff = 1 / Math.pow(k + 1, 0.85);
      const amp = (0.35 + 0.65 * rtBalance) * rolloff;
      const phase = chunkRand() * Math.PI * 2;
      const detuneCents = 3 + chunkRand() * 6; // 3-9 cents
      return { freq: baseFreq * ratio, amp, phase, detuneCents };
    });

    // Normalise partial amplitudes so the pre-envelope sum is well-behaved regardless of numPartials.
    const ampSum = partials.reduce((a, p) => a + p.amp, 0) || 1;
    for (const p of partials) p.amp /= ampSum;

    // Slow "breathing" amplitude LFO — organic, not metronomic.
    const breathFreq = 0.18 + chunkRand() * 0.22; // ~0.18-0.4 Hz
    const breathDepth = 0.16;
    const breathPhase = chunkRand() * Math.PI * 2;

    const attackN = Math.round(chunkSeconds * 0.14 * sampleRate);
    const releaseN = Math.round(chunkSeconds * 0.2 * sampleRate);

    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      let s = 0;
      for (const p of partials) {
        const detuneRatio = Math.pow(2, p.detuneCents / 1200);
        s += p.amp * 0.55 * Math.sin(2 * Math.PI * p.freq * t + p.phase);
        s += p.amp * 0.24 * Math.sin(2 * Math.PI * p.freq * detuneRatio * t + p.phase + 1.7);
        s += p.amp * 0.21 * Math.sin(2 * Math.PI * (p.freq / detuneRatio) * t + p.phase - 1.1);
      }

      const breath = 1 + breathDepth * Math.sin(2 * Math.PI * breathFreq * t + breathPhase);

      let env = 1;
      if (i < attackN) env = 0.5 - 0.5 * Math.cos((Math.PI * i) / attackN); // raised-cosine attack
      else if (i > n - releaseN) env = 0.5 - 0.5 * Math.cos((Math.PI * (n - i)) / releaseN); // raised-cosine release

      buf[i] = s * breath * env;
    }

    for (const click of clicksByChunk.get(chunkIndex) ?? []) {
      renderClick(buf, Math.round(click.localTime * sampleRate), sampleRate, click.strength, chunkRand);
    }

    // Remove DC.
    let dc = 0;
    for (let i = 0; i < n; i++) dc += buf[i];
    dc /= n;
    for (let i = 0; i < n; i++) buf[i] -= dc;

    // Peak-normalise to -3 dBFS (guard silence / NaN).
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const v = Math.abs(buf[i]);
      if (Number.isFinite(v) && v > peak) peak = v;
    }
    const scale = peak > 1e-9 ? TARGET_PEAK / peak : 0;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const v = buf[i] * scale;
      out[i] = Number.isFinite(v) ? v : 0;
    }

    const wav = encodeWav([out], sampleRate);
    chunks.push({ name: `c${String(chunkIndex).padStart(2, "0")}.wav`, wav });
  }

  return chunks;
}
