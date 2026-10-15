/** Deterministic local interaction regressions; no browser, WebGL, network, or Atlas calls.
 * Run: npx tsx scripts/verify-interactions.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DataTexture, Vector3, type WebGLRenderer } from 'three';
import { OrganismRig, type RigInput } from '../src/components/organism/rig';
import { SurfaceSampler } from '../src/components/organism/surface';
import { freshRhythm, nextRhythm, springStep } from '../src/lib/interactions';
import { useChrono } from '../src/lib/store';
import { LENS_OFF, type Specimen, type SurfaceGesture } from '../src/lib/chain/types';

const manifest = JSON.parse(readFileSync(new URL('../public/specimens/42ac05/manifest.json', import.meta.url), 'utf8')) as Specimen;
const gesture: SurfaceGesture = { kind: 'pressure', u: 0.3, v: 0.7, dx: 0.1, dy: -0.05, heldAt: 1_000, active: true };
const wound = { u: 0.6, v: 0.4, strength: 0.8, t: 2_000 };

// First tap establishes tempo; the next lands close to the 90 BPM beat.
const first = nextRhythm(freshRhythm(90), 1_000);
assert.deepEqual(first, { at: 1_000, taps: 1, streak: 0, accuracy: null, bpm: 90 });
const onBeat = nextRhythm(first, 1_667);
assert.equal(onBeat.taps, 2);
assert.ok(onBeat.accuracy !== null && onBeat.accuracy > 0.99, `on-beat accuracy should be high: ${onBeat.accuracy}`);
assert.equal(onBeat.streak, 1);

// Debounce returns the exact previous state; an offbeat breaks the streak, and a missed
// interval clears accuracy instead of pretending the late tap belongs to the same beat.
assert.equal(nextRhythm(onBeat, 1_767), onBeat, 'rapid repeat under 120ms is ignored');
const offBeat = nextRhythm(onBeat, 2_667);
assert.equal(offBeat.accuracy, 0);
assert.equal(offBeat.streak, 0);
assert.equal(nextRhythm(offBeat, 4_500).accuracy, null, 'long gap has no beat score');
assert.deepEqual(freshRhythm(120), { at: 0, taps: 0, streak: 0, accuracy: null, bpm: 120 }, 'tempo reset clears old taps');

// The exact spring step moves toward its target, remains finite for a throttled frame,
// and leaves an already settled point unchanged.
const [settledPosition, settledVelocity] = springStep(0.4, 0, 0.4, 1 / 60);
assert.equal(settledPosition, 0.4);
assert.equal(settledVelocity, 0);
const [springPosition, springVelocity] = springStep(0, 0, 1, 1 / 60);
assert.ok(springPosition > 0 && springPosition < 1 && springVelocity > 0);
const throttled = springStep(springPosition, springVelocity, 1, 5);
assert.ok(throttled.every(Number.isFinite), 'clamped throttled-frame spring remains finite');

// The CPU mirror follows the shader's local gesture displacement, including an opposite tug.
// This fake renderer only answers the float-texture capability query; it creates no GL context.
const fakeRenderer = { extensions: { has: () => true } } as unknown as WebGLRenderer;
const rig = new OrganismRig(fakeRenderer);
try {
  const renderState: RigInput = {
    controls: manifest.controls,
    audioLevel: 0,
    pendingWounds: [],
    lens: LENS_OFF,
    probe: null,
    runs: {},
    mode: 'idle',
    interactionMode: 'tug',
    gesture: null,
    rhythm: freshRhythm(),
    lightProbe: null,
  };
  rig.setSpecimen({ ...manifest, colony: undefined, skin: undefined, tissue: undefined, mask: undefined, membrane: undefined, voice: undefined, echo: undefined });
  const settle = () => { for (let i = 0; i < 120; i++) rig.update(1 / 60, 1_000_000, renderState); };
  settle();
  const uniformData = (name: string) => (rig.material.uniforms[name].value as DataTexture).image.data as Float32Array;
  const surface = new SurfaceSampler(rig.material.uniforms, uniformData('uSoma'), uniformData('uRelief'));
  const uvDirection = (u: number, v: number) => {
    const phi = u * Math.PI * 2;
    const polar = (1 - v) * Math.PI;
    const ring = Math.sin(polar);
    return new Vector3(-Math.cos(phi) * ring, Math.cos(polar), Math.sin(phi) * ring);
  };
  const direction = uvDirection(0.3, 0.7);
  const opposite = direction.clone().negate();
  renderState.gesture = { ...gesture, kind: 'tug', dx: 0, dy: 0 };
  settle();
  const gestureUniform = rig.material.uniforms.uGesture.value as { x: number; y: number; z: number; w: number };
  const amplitude = gestureUniform.w;
  const gestureDirection = new Vector3(gestureUniform.x, gestureUniform.y, gestureUniform.z);
  const paired = rig.material.uniforms.uGesturePair.value as number;
  const directWithGesture = surface.displacement(direction.x, direction.y, direction.z, 1);
  const oppositeWithGesture = surface.displacement(opposite.x, opposite.y, opposite.z, 1);
  gestureUniform.w = 0;
  const directWithoutGesture = surface.displacement(direction.x, direction.y, direction.z, 1);
  const oppositeWithoutGesture = surface.displacement(opposite.x, opposite.y, opposite.z, 1);
  gestureUniform.w = amplitude;
  const directDelta = directWithGesture - directWithoutGesture;
  const oppositeDelta = oppositeWithGesture - oppositeWithoutGesture;
  const dot = direction.dot(gestureDirection);
  const directExpected = amplitude * (Math.exp((dot - 1) * 13) - paired * Math.exp((-dot - 1) * 13));
  const oppositeExpected = amplitude * (Math.exp((-dot - 1) * 13) - paired * Math.exp((dot - 1) * 13));
  assert.ok(Math.abs(directDelta - directExpected) < 1e-6, 'CPU surface applies tug at the touched point');
  assert.ok(Math.abs(oppositeDelta - oppositeExpected) < 1e-6, 'CPU surface applies the paired response once at the antipode');
  renderState.gesture = null;
  settle();
  const releasedAmplitude = gestureUniform.w;
  const releasedDirect = surface.displacement(direction.x, direction.y, direction.z, 1);
  const releasedOpposite = surface.displacement(opposite.x, opposite.y, opposite.z, 1);
  gestureUniform.w = 0;
  const releasedBaseDirect = surface.displacement(direction.x, direction.y, direction.z, 1);
  const releasedBaseOpposite = surface.displacement(opposite.x, opposite.y, opposite.z, 1);
  gestureUniform.w = releasedAmplitude;
  assert.ok(Math.abs(releasedAmplitude) < 1e-6, 'released tug spring settles to zero amplitude');
  assert.ok(Math.abs(releasedDirect - releasedBaseDirect) < 1e-6, 'released direct displacement returns to baseline');
  assert.ok(Math.abs(releasedOpposite - releasedBaseOpposite) < 1e-6, 'released antipodal displacement returns to baseline');
} finally {
  rig.dispose();
}

const store = useChrono.getState();
store.resetToNew();
store.setMode('idle');
store.setSpecimen(null);
store.setAudioEnabled(false);
store.setInteractionMode('rhythm');
store.setRhythmBpm(120);
store.tapRhythm(10_000);
assert.equal(useChrono.getState().rhythm.taps, 0, 'rhythm is disabled without a specimen');
assert.equal(useChrono.getState().audioEnabled, false, 'rhythm never enables audio');
store.setGesture(gesture);
assert.equal(useChrono.getState().gesture, null, 'gesture is disabled without a specimen');

// Load the fixture, then exercise transient interaction changes while guarding persistent inputs.
store.setControls({ circuitDepth: 9, entanglement: 0.72, decay: 0.31 });
store.addWound(wound);
store.setSpecimen(manifest);
store.setInteractionMode('rhythm');
store.tapRhythm(20_000);
store.tapRhythm(20_500);
assert.equal(useChrono.getState().rhythm.taps, 2);
assert.equal(useChrono.getState().rhythm.bpm, 120);
store.setGesture(gesture);
store.setProbe({ u: 0.2, v: 0.8, source: 'blob' });
store.setLightProbe({ x: 0.1, y: -0.2 });

const controlsBefore = structuredClone(useChrono.getState().controls);
const woundsBefore = structuredClone(useChrono.getState().pendingWounds);
const manifestBefore = JSON.stringify(useChrono.getState().specimen);
store.setInteractionMode('pressure');
let state = useChrono.getState();
assert.equal(state.gesture, null);
assert.equal(state.probe, null);
assert.equal(state.lightProbe, null);
assert.deepEqual(state.rhythm, freshRhythm(120));
assert.deepEqual(state.controls, controlsBefore);
assert.deepEqual(state.pendingWounds, woundsBefore);
assert.equal(JSON.stringify(state.specimen), manifestBefore, 'changing interaction mode does not alter the specimen manifest');

// A specimen-generation change clears transient state while preserving user inputs and tempo.
store.setInteractionMode('rhythm');
store.tapRhythm(30_000);
store.setGesture(gesture);
store.setProbe({ u: 0.7, v: 0.3, source: 'panel' });
store.setLightProbe({ x: -0.4, y: 0.5 });
const nextGeneration = { ...manifest, generation: manifest.generation + 1 };
store.setSpecimen(nextGeneration);
state = useChrono.getState();
assert.equal(state.gesture, null);
assert.equal(state.probe, null);
assert.equal(state.lightProbe, null);
assert.deepEqual(state.rhythm, freshRhythm(120));
assert.deepEqual(state.controls, controlsBefore);
assert.deepEqual(state.pendingWounds, woundsBefore);
assert.equal(JSON.stringify(state.specimen), JSON.stringify(nextGeneration), 'loading a generation leaves manifest data untouched');

// Busy mode clears a live gesture/rhythm and rejects new local inputs until idle.
store.setInteractionMode('rhythm');
store.tapRhythm(40_000);
store.setGesture(gesture);
store.setMode('evolving', 'decoherence');
const busyRhythm = structuredClone(useChrono.getState().rhythm);
assert.equal(useChrono.getState().gesture, null, 'busy transition clears an active gesture');
store.tapRhythm(40_500);
store.setGesture(gesture);
state = useChrono.getState();
assert.deepEqual(state.rhythm, busyRhythm, 'busy state blocks rhythm taps');
assert.equal(state.gesture, null, 'busy state blocks new gestures');
assert.deepEqual(state.controls, controlsBefore);
assert.deepEqual(state.pendingWounds, woundsBefore);
assert.equal(JSON.stringify(state.specimen), JSON.stringify(nextGeneration), 'busy transition does not alter specimen manifest');

store.resetToNew();
console.log('PASS rhythm timing/debounce, spring stability, direct/paired CPU gesture displacement, disabled and busy input guards, transient resets, and persistent specimen inputs');
