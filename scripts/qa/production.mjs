/** Browser smoke against the built Worker; no development store handle or paid API calls. */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { open } from "./harness.mjs";

const [base = "http://localhost:3103", out = "/private/tmp/chrono-production"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const t = await open({ url: base, width: 1280, height: 800, dpr: 1, settleMs: 6000 });
try {
  const { page } = t;
  assert.equal(await page.getByRole("button", { name: "Create", exact: true }).count(), 1);
  assert.equal(t.api.length, 0);
  assert.ok((await t.lit()).litPct > 0.5, "embryo renders in production");
  assert.equal(await page.evaluate(() => typeof window.__chrono), "undefined", "development stores stay private");
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("dialog", { name: "Archive" }).getByRole("button", { name: "Specimen 42AC, generation 1", exact: true }).click();
  await page.getByRole("button", { name: "Evolve", exact: true }).waitFor();
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: /^06 Membrane/ }).click();
  await page.getByRole("switch", { name: "Compare", exact: true }).click();
  assert.equal(await page.getByRole("switch", { name: "Compare", exact: true }).getAttribute("aria-checked"), "true");
  await page.waitForTimeout(2000);
  await t.shot(`${out}/worker-membrane`);
  await page.getByRole("button", { name: "New specimen", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).waitFor();
  assert.equal(t.api.length, 0);
  const errors = t.errors.filter(e => !/AudioContext|GL Driver|THREE\.Clock/.test(e));
  assert.deepEqual(errors, []);
  console.log("PASS built Worker: blank boot, WebGL, archive selection, lens compare, New specimen, private dev state, zero API calls/errors");
} catch (error) {
  await t.shot(`${out}/failure`).catch(() => {});
  console.error(t.errors);
  throw error;
} finally {
  await t.close();
}
