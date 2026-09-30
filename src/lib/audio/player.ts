"use client";
/**
 * player.ts — OWNER: audio agent. Browser-only Web Audio playback engine for the organism's
 * voice (specimen.echo, falling back to specimen.voice). Not imported by Node/tsx scripts.
 *
 * Graph:
 *   sourceA \                                                                  -> destination
 *   sourceB  -> panner (slow LFO drift) -> master gain (enable/disable fade) -> compressor (limiter) -> analyser -/
 *   click   /
 *
 * Two loop sources (A/B) let setUrl() crossfade (2s, equal-power) between the previous and next
 * loop instead of hard-cutting. click() synthesizes an immediate short "cellular click" grain
 * directly with Web Audio nodes (no WAV round-trip) for low-latency wound feedback.
 */

interface Voice {
  source: AudioBufferSourceNode | null;
  gain: GainNode;
}

let ctx: AudioContext | null = null;
let panner: StereoPannerNode | null = null;
let master: GainNode | null = null;
let compressor: DynamicsCompressorNode | null = null;
let analyser: AnalyserNode | null = null;
let pannerLfo: OscillatorNode | null = null;
let pannerLfoGain: GainNode | null = null;

let voiceA: Voice | null = null;
let voiceB: Voice | null = null;
let activeIsA = true;

let currentUrl: string | null = null;
let playbackRequestId = 0;
const bufferCache = new Map<string, AudioBuffer>();
let enabled = false;

const CROSSFADE_SEC = 2.0;
const MASTER_FADE_SEC = 0.6;

function build(context: AudioContext) {
  panner = context.createStereoPanner();
  master = context.createGain();
  master.gain.value = 0; // starts disabled; setEnabled(true) fades it in
  compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -6;
  compressor.knee.value = 6;
  compressor.ratio.value = 20;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;
  analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.8;

  panner.connect(master);
  master.connect(compressor);
  compressor.connect(analyser);
  analyser.connect(context.destination);

  // Slow spatial drift so the organism feels like it breathes in space, not glued to center.
  pannerLfo = context.createOscillator();
  pannerLfo.frequency.value = 0.05; // ~20s period
  pannerLfoGain = context.createGain();
  pannerLfoGain.gain.value = 0.35;
  pannerLfo.connect(pannerLfoGain);
  pannerLfoGain.connect(panner.pan);
  pannerLfo.start();

  voiceA = { source: null, gain: context.createGain() };
  voiceB = { source: null, gain: context.createGain() };
  voiceA.gain.gain.value = 1;
  voiceB.gain.gain.value = 0;
  voiceA.gain.connect(panner);
  voiceB.gain.connect(panner);
}

/** Lazily create (or resume) the AudioContext. Safe to call outside a gesture; cheapest to call
 *  synchronously inside one (e.g. the AudioToggle click handler) so autoplay policies are happy. */
export function ensureAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    ctx = new Ctor();
    build(ctx);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Call from a user-gesture handler (e.g. the toggle's onClick) to satisfy autoplay policies. */
export function unlockAudioContext(): void {
  ensureAudioContext();
}

async function loadBuffer(url: string): Promise<AudioBuffer | null> {
  const context = ensureAudioContext();
  if (!context) return null;
  const cached = bufferCache.get(url);
  if (cached) return cached;
  try {
    const res = await fetch(url);
    const arr = await res.arrayBuffer();
    const buf = await context.decodeAudioData(arr.slice(0));
    bufferCache.set(url, buf);
    return buf;
  } catch {
    return null;
  }
}

function equalPowerCurve(steps: number, rising: boolean): Float32Array {
  const curve = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const x = i / (steps - 1);
    curve[i] = rising ? Math.sin((x * Math.PI) / 2) : Math.cos((x * Math.PI) / 2);
  }
  return curve;
}

/** Stop the specimen loop when cleared; otherwise load a WAV and crossfade from the previous loop. */
export function setUrl(url: string | null): void {
  if (url === currentUrl) return;
  currentUrl = url;
  const requestId = ++playbackRequestId;

  if (!url) {
    if (ctx && voiceA && voiceB) {
      const now = ctx.currentTime;
      for (const voice of [voiceA, voiceB]) {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setTargetAtTime(0, now, 0.025);
        const source = voice.source;
        voice.source = null;
        try {
          source?.stop(now + 0.1);
        } catch {
          // A source may already have stopped as its crossfade completed.
        }
      }
    }
    activeIsA = true;
    return;
  }

  const context = ensureAudioContext();
  if (!context || !voiceA || !voiceB) return;

  void loadBuffer(url).then((buffer) => {
    if (!buffer || !ctx || url !== currentUrl || requestId !== playbackRequestId || !voiceA || !voiceB) return;

    const incoming = activeIsA ? voiceB : voiceA;
    const outgoing = activeIsA ? voiceA : voiceB;
    activeIsA = !activeIsA;

    incoming.source?.stop();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(incoming.gain);
    src.start();
    incoming.source = src;

    const now = ctx.currentTime;
    const steps = 64;
    incoming.gain.gain.cancelScheduledValues(now);
    incoming.gain.gain.setValueCurveAtTime(equalPowerCurve(steps, true), now, CROSSFADE_SEC);
    outgoing.gain.gain.cancelScheduledValues(now);
    outgoing.gain.gain.setValueCurveAtTime(equalPowerCurve(steps, false), now, CROSSFADE_SEC);

    const finishedSrc = outgoing.source;
    setTimeout(() => {
      if (outgoing.source === finishedSrc) {
        finishedSrc?.stop();
        outgoing.source = null;
      }
    }, CROSSFADE_SEC * 1000 + 100);
  });
}

/** Master enable/disable fade (click-free). Also unlocks the AudioContext. */
export function setEnabled(on: boolean): void {
  enabled = on;
  const context = ensureAudioContext();
  if (!context || !master) return;
  const now = context.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setTargetAtTime(on ? 1 : 0, now, MASTER_FADE_SEC / 3);
}

/** Fill `out` with frequency-domain data (0..255), resampled to out.length. */
export function getSpectrum(out: Uint8Array): void {
  if (!analyser) {
    out.fill(0);
    return;
  }
  const full = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(full);
  if (out.length === full.length) {
    out.set(full);
    return;
  }
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor((i * full.length) / out.length);
    const end = Math.max(start + 1, Math.floor(((i + 1) * full.length) / out.length));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end && j < full.length; j++) {
      sum += full[j];
      count++;
    }
    out[i] = count ? Math.round(sum / count) : 0;
  }
}

let timeDomainBuf: Uint8Array<ArrayBuffer> | null = null;

/** RMS level of the current output, 0..1. */
export function level(): number {
  if (!analyser) return 0;
  if (!timeDomainBuf || timeDomainBuf.length !== analyser.fftSize) {
    timeDomainBuf = new Uint8Array(analyser.fftSize);
  }
  analyser.getByteTimeDomainData(timeDomainBuf);
  let sumSq = 0;
  for (let i = 0; i < timeDomainBuf.length; i++) {
    const v = (timeDomainBuf[i] - 128) / 128;
    sumSq += v * v;
  }
  return Math.sqrt(sumSq / timeDomainBuf.length);
}

/** Immediate short synthesized "cellular click" / wet membrane pluck for wound feedback.
 *  Only audible when audio is enabled (mirrors the drone's own mute state). */
export function click(strength = 1): void {
  if (!enabled) return;
  const context = ensureAudioContext();
  if (!context || !panner) return;

  const now = context.currentTime;
  const dur = 0.09;
  const n = Math.max(1, Math.round(dur * context.sampleRate));
  const buffer = context.createBuffer(1, n, context.sampleRate);
  const data = buffer.getChannelData(0);
  let lp = 0;
  const a = 0.68;
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1;
    lp = a * lp + (1 - a) * white;
    data[i] = lp;
  }

  const src = context.createBufferSource();
  src.buffer = buffer;

  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 900 + Math.random() * 1400;
  filter.Q.value = 1.2;

  const envGain = context.createGain();
  const peak = Math.max(0.05, Math.min(1, strength)) * 0.5;
  envGain.gain.setValueAtTime(0, now);
  envGain.gain.linearRampToValueAtTime(peak, now + 0.002);
  envGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

  src.connect(filter);
  filter.connect(envGain);
  envGain.connect(panner);

  src.start(now);
  src.stop(now + dur + 0.02);
}
