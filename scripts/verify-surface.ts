/** CPU viewport regressions; no browser, WebGL context, Atlas calls, or credits.
 * Run: npx tsx scripts/verify-surface.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DataTexture, Matrix4, PerspectiveCamera, Vector3, type WebGLRenderer } from 'three';
import { OrganismRig, type RigInput } from '../src/components/organism/rig';
import { SurfaceSampler } from '../src/components/organism/surface';
import { LensAnimator } from '../src/components/organism/lens';
import { poleMeans, somaField } from '../src/components/organism/artifacts';
import { LENS_OFF, type Specimen } from '../src/lib/chain/types';

const manifest = JSON.parse(readFileSync(new URL('../public/specimens/42ac05/manifest.json', import.meta.url), 'utf8')) as Specimen;
// The constructor only queries float-texture support. No renderer or GL context is created.
const renderer = { extensions: { has: () => true } } as unknown as WebGLRenderer;
const rig = new OrganismRig(renderer);
const state: RigInput = { controls: manifest.controls, audioLevel: 0, pendingWounds: [], lens: LENS_OFF, probe: null, runs: {}, mode: 'idle' };
const now = 1_000_000;
const settle = () => { for (let i = 0; i < 120; i++) rig.update(1 / 60, now, state); };
const scalarValues = (name: string) => (rig.material.uniforms[name].value as DataTexture).image.data as Float32Array;
const surface = new SurfaceSampler(rig.material.uniforms, scalarValues('uSoma'), scalarValues('uRelief'));

try {
  // Leave image artifacts out: the picking test only needs actual genome and displacement data.
  rig.setSpecimen({ ...manifest, colony: undefined, skin: undefined, tissue: undefined, mask: undefined, membrane: undefined, voice: undefined, echo: undefined });
  settle();
  const camera = new PerspectiveCamera(30, 1, 0.1, 80);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const matrix = new Matrix4(), point = new Vector3(), ray = new Vector3();
  let count = 0;
  for (const stage of [null, 'soma', 'genesis'] as const) {
    state.lens = { stage, amount: 1, compare: !!stage, overlay: false };
    rig.setPointer(0);
    settle();
    let max = 0;
    for (let iy = -5; iy <= 5; iy++) for (let ix = -5; ix <= 5; ix++) {
      const x = ix * 0.13, y = iy * 0.13;
      const d = new Vector3(x, y, Math.sqrt(1 - x * x - y * y));
      const stretch = rig.material.uniforms.uStretch.value as Vector3;
      const p = d.clone().multiply(stretch).project(camera);
      const wipe = rig.material.uniforms.uWipe.value as Vector3;
      const a = Math.min(1, Math.max(0, (p.x - (wipe.x - wipe.z)) / (2 * wipe.z)));
      const side = 1 + (a * a * (3 - 2 * a) - 1) * wipe.y;
      surface.point(d.x, d.y, d.z, side, point);
      ray.copy(point).sub(camera.position).normalize();
      const hit = rig.pick(camera.position, ray, matrix, camera);
      assert.ok(hit, 'visible surface ray must hit');
      const expectedU = ((Math.atan2(d.z, -d.x) / (2 * Math.PI)) % 1 + 1) % 1;
      const expectedV = 1 - Math.acos(d.y) / Math.PI;
      const du = Math.abs(hit.u - expectedU);
      const error = Math.hypot(Math.min(du, 1 - du), hit.v - expectedV);
      max = Math.max(max, error);
      assert.ok(hit.phase.every((v) => v >= 0 && v < 1), 'LUT phases wrap to [0,1)');
      assert.ok(hit.theta >= 0 && hit.theta <= Math.PI / 2, 'LUT angle remains physical');
      count++;
    }
    assert.ok(max < 0.002, `${stage ?? 'normal'} picking remains well within one 32px texel: ${max}`);
    console.log(`PASS ${stage ?? 'normal'} surface picking: max UV error ${max.toExponential(2)}`);
  }

  // Transient ripples must also be present in the CPU mirror used for wound/probe hits.
  state.lens = LENS_OFF;
  settle();
  const d = new Vector3(0, 0, 1);
  const before = surface.displacement(d.x, d.y, d.z, 1);
  const age = 0.2, strength = 0.8;
  rig.addLocalWound({ u: 0.25, v: 0.5, strength, t: now - age * 1000 });
  rig.update(0, now, state);
  const after = surface.displacement(d.x, d.y, d.z, 1);
  const wave = (angle: number) => {
    const x = angle - age * 0.85;
    return Math.cos(x * 20) * Math.exp(-x * x * 22 - age * 0.95) * 0.032 - Math.exp(-angle * angle * 70 - age * 3.2) * 0.055;
  };
  const expected = strength * (wave(0) + state.controls.entanglement * 0.85 * wave(Math.PI));
  assert.ok(Math.abs(after - before - expected) < 1e-7, 'CPU ripple includes the direct wound and entangled antipode');

  const field = somaField({ size: 4, variance: 5 / 36, grid: Array.from({ length: 16 }, (_, i) => 1 - Math.floor(i / 4) / 3) });
  assert.ok(field);
  const [north, south] = poleMeans(field);
  assert.ok(north > 0 && south < 0, 'image top row maps to sphere north');

  rig.setSpecimen({ ...manifest, colony: undefined, skin: undefined, tissue: undefined, mask: undefined, membrane: undefined, voice: undefined, echo: { url: '/test-echo.wav' } });
  state.lens = { stage: 'membrane', amount: 1, compare: true, overlay: false };
  settle();
  const echoAmounts = rig.shellsMaterial.uniforms.uLEcho.value;
  assert.ok(echoAmounts.x > 0.99 && echoAmounts.y > 0.99, 'another engine comparison preserves echo on both sides');
  state.lens = { stage: 'echo', amount: 1, compare: true, overlay: false };
  settle();
  assert.ok(echoAmounts.x < 0.01 && echoAmounts.y > 0.99, 'Echo comparison isolates shells to its With half');
  state.lens = { stage: 'echo', amount: 0, compare: false, overlay: false };
  settle();
  assert.equal(rig.shellsVisible, false, 'Echo Without hides shells');

  const lens = new LensAnimator();
  lens.watchRuns({ soma: { status: 'done' } }, now);
  lens.update(0.1, LENS_OFF, true, false);
  assert.equal(lens.reveal, -1, 'archive load never reveals');
  lens.watchRuns({ soma: { status: 'running' } }, now);
  lens.watchRuns({ soma: { status: 'done', finishedAt: now } }, now);
  lens.update(0.1, LENS_OFF, true, true);
  assert.equal(lens.reveal, -1, 'drag defers reveal');
  lens.update(0.1, LENS_OFF, true, false);
  assert.equal(lens.reveal, 4, 'release starts soma reveal');
  for (let i = 0; i < 40; i++) lens.update(0.1, LENS_OFF, true, false);
  assert.equal(lens.reveal, -1, 'reveal ends');
  assert.ok(lens.R[4] > 0.99, 'reveal restores contribution');
  rig.setSpecimen(null);
  settle();
  assert.ok(rig.debug().embryo > 0.99 && rig.debug().soma < 0.01, 'reset dissolves back to embryo');
  console.log(`PASS ${count} surface samples, transient ripple, image orientation, echo comparison, reveal lifecycle, and embryo reset`);
} finally {
  rig.dispose();
}
