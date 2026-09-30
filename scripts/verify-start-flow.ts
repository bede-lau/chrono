/** Free regression checks for archive loading and the New specimen reset. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadArchive } from "../src/lib/chain/controller";
import type { Specimen } from "../src/lib/chain/types";
import { useChrono } from "../src/lib/store";

const specimen = JSON.parse(await readFile(new URL("../public/specimens/42ac05/manifest.json", import.meta.url), "utf8")) as Specimen;
const requests: string[] = [];
const fetchBefore = globalThis.fetch;
globalThis.fetch = async (input) => {
  requests.push(String(input));
  assert.equal(String(input), "/specimens/index.json", "listing the archive must not open a specimen or start an engine");
  return Response.json({ specimens: [{ id: specimen.id, name: specimen.name }] });
};

try {
  await loadArchive();
  assert.equal(useChrono.getState().archive.length, 1);
  assert.equal(useChrono.getState().specimen, null);
  assert.equal(useChrono.getState().mode, "idle");
  assert.deepEqual(useChrono.getState().runs, {});

  const st = useChrono.getState();
  st.setSpecimen(specimen);
  st.setControls({ decay: 0.79 });
  st.addWound({ u: 0.25, v: 0.8, strength: 0.9, t: 1 });
  st.selectStage("decoherence");
  st.setLens({ stage: "decoherence", compare: true, overlay: true });
  st.setProbe({ u: 0.25, v: 0.8, source: "panel" });
  await loadArchive();
  assert.equal(useChrono.getState().specimen, specimen, "refreshing the archive preserves the selected specimen");
  st.resetToNew();
  const blank = useChrono.getState();
  assert.equal(blank.specimen, null);
  assert.equal(blank.controls.decay, 0.79);
  assert.equal(blank.archive.length, 1);
  assert.equal(blank.mode, "idle");
  assert.equal(blank.activeStage, null);
  assert.equal(blank.selectedStage, null);
  assert.equal(blank.lens.stage, null);
  assert.equal(blank.probe, null);
  assert.deepEqual(blank.pendingWounds, []);
  assert.deepEqual(blank.runs, {});
  assert.deepEqual(requests, ["/specimens/index.json", "/specimens/index.json"]);
  console.log("PASS archive loads only its list; New specimen clears organism state and preserves controls without API traffic");
} finally {
  globalThis.fetch = fetchBefore;
}
