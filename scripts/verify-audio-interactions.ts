/** Mocked Web Audio resource checks; no browser, network, or external service is used.
 * Run: npx tsx scripts/verify-audio-interactions.ts
 */
import assert from 'node:assert/strict';

class MockParam {
  value = 0;
  setValueAtTime(value: number) { this.value = value; }
  linearRampToValueAtTime(value: number) { this.value = value; }
  exponentialRampToValueAtTime(value: number) { this.value = value; }
  setTargetAtTime(value: number) { this.value = value; }
  setValueCurveAtTime(values: Float32Array) { this.value = values.at(-1) ?? this.value; }
  cancelScheduledValues() {}
}

class MockNode {
  disconnectCount = 0;
  connect<T>(destination: T): T { return destination; }
  disconnect() { this.disconnectCount++; }
}

class MockOscillator extends MockNode {
  frequency = new MockParam();
  type = 'sine';
  onended: (() => void) | null = null;
  startAt: number | undefined;
  stopAt: number | undefined;
  start(at?: number) { this.startAt = at; }
  stop(at?: number) { this.stopAt = at; }
}

class MockGain extends MockNode { gain = new MockParam(); }
class MockPanner extends MockNode { pan = new MockParam(); }
class MockCompressor extends MockNode {
  threshold = new MockParam();
  knee = new MockParam();
  ratio = new MockParam();
  attack = new MockParam();
  release = new MockParam();
}
class MockAnalyser extends MockNode {
  fftSize = 2048;
  frequencyBinCount = 1024;
  smoothingTimeConstant = 0;
  getByteFrequencyData(data: Uint8Array) { data.fill(0); }
  getByteTimeDomainData(data: Uint8Array) { data.fill(128); }
}

class MockAudioContext {
  static instances: MockAudioContext[] = [];
  readonly destination = new MockNode();
  readonly oscillators: MockOscillator[] = [];
  decodeCount = 0;
  state: AudioContextState = 'suspended';
  currentTime = 5;
  sampleRate = 48_000;
  constructor() { MockAudioContext.instances.push(this); }
  createStereoPanner() { return new MockPanner(); }
  createGain() { return new MockGain(); }
  createDynamicsCompressor() { return new MockCompressor(); }
  createAnalyser() { return new MockAnalyser(); }
  createOscillator() {
    const oscillator = new MockOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }
  createBufferSource() { return new MockOscillator() as unknown as AudioBufferSourceNode; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  decodeAudioData() { this.decodeCount++; return Promise.resolve({} as AudioBuffer); }
}

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { AudioContext: MockAudioContext },
});
let fetchCount = 0;
Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  value: async () => {
    fetchCount++;
    return { arrayBuffer: async () => new ArrayBuffer(8) };
  },
});

const player = await import('../src/lib/audio/player');
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// An archive URL arriving while muted must not even construct an AudioContext or fetch bytes.
player.setUrl('/archive.wav');
await flush();
assert.equal(MockAudioContext.instances.length, 0, 'muted URL creates no AudioContext');
assert.equal(fetchCount, 0, 'muted URL performs no fetch');

// Enabling audio and setting the unchanged specimen URL then loads and decodes it normally.
player.setEnabled(true);
player.setUrl('/archive.wav');
await flush();
await flush();
const context = MockAudioContext.instances[0];
assert.ok(context);
assert.equal(fetchCount, 1, 'same URL loads when playback is enabled');
assert.equal(context.decodeCount, 1, 'enabled URL is decoded once');
assert.ok(context.oscillators.length >= 1, 'audio graph creates its panner oscillator');

// Rapid rhythm input stays under the hard eight-voice cap, and ended voices disconnect.
const firstRhythmOscillator = context.oscillators.length;
for (let i = 0; i < 12; i++) player.rhythmNote(1, 0.95);
const burst = context.oscillators.slice(firstRhythmOscillator);
assert.equal(burst.length, 8, 'rapid taps cannot exceed the eight-voice limit');
for (const oscillator of burst) {
  assert.ok(oscillator.stopAt !== undefined && oscillator.startAt !== undefined, 'each note has a bounded stop time');
  oscillator.onended?.();
  assert.ok(oscillator.disconnectCount > 0, 'ended note disconnects its oscillator');
}

// Muting cancels both immediate and delayed answer voices before the graph suspends.
const beforeMute = context.oscillators.length;
player.rhythmNote(1, 0.95);
const pending = context.oscillators.slice(beforeMute);
assert.equal(pending.length, 2, 'streak schedules a quiet delayed answer');
player.setEnabled(false);
for (const oscillator of pending) {
  assert.ok(oscillator.stopAt !== undefined, 'mute stops pending notes');
  assert.ok(oscillator.disconnectCount > 0, 'mute disconnects pending note nodes');
  assert.equal(oscillator.onended, null, 'canceled note cannot run a stale cleanup callback after unmute');
}

// A URL change while muted is deferred, then loads after enabling playback.
player.setUrl('/next-archive.wav');
await flush();
assert.equal(fetchCount, 1, 'muted URL changes remain deferred');
assert.equal(context.decodeCount, 1, 'muted URL is not decoded');
player.setEnabled(true);
player.setUrl('/next-archive.wav');
await flush();
await flush();
assert.equal(fetchCount, 2, 'deferred URL loads after unmute');
assert.equal(context.decodeCount, 2, 'deferred URL decodes after unmute');
player.setEnabled(false);
console.log('PASS muted URL deferral, same-URL unmute load, bounded rhythm voices, end cleanup, and mute cancellation');
