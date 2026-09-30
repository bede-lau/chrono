/** Temporal GPU regression: a screenshot alone misses intermittent black frames.
 * Uses Playwright's WebKit on Apple GPU by default, matching the in-app browser.
 * Install its browser binary, if needed: ./deck/node_modules/.bin/playwright install webkit
 * Run against Next dev for accelerated animation, or the built Worker for real-time coverage.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, webkit } from "../../deck/node_modules/playwright/index.mjs";

const [base = "http://localhost:3000", out = "/private/tmp/chrono-flicker", backend = "webkit", baseline] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const browser = await (backend === "chromium" ? chromium : webkit).launch();
const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
const errors = [], api = [], report = [];
page.on("pageerror", error => errors.push(String(error)));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
page.on("request", request => { if (request.url().includes("/api/moth/")) api.push(request.url()); });
try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Create", exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector("canvas")?.width > 0);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  const renderer = await page.evaluate(() => {
    const gl = document.querySelector("canvas").getContext("webgl2");
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
  });
  // Optional A/B control for the diagnosed fault; only mutates this isolated dev browser.
  if (baseline === "--baseline") {
    await page.waitForFunction(() => !!window.__organismRig, null, { timeout: 10000 });
    await page.evaluate(() => {
      const material = window.__organismRig?.shellsMaterial;
      if (!material) throw new Error("The baseline control requires Next dev's rig handle");
      material.fragmentShader = material.fragmentShader.replace(
        "clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0)",
        "abs(dot(normalize(vN), normalize(vV)))",
      );
      material.needsUpdate = true;
    });
  }
  for (const [specimen, name] of [["42ac05-g1", "Specimen 42AC, generation 1"], ["308761", "Specimen 3087, generation 0"], ["6a5efd", "Specimen 6A5E, generation 0"]]) {
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await page.getByRole("dialog", { name: "Archive" }).getByRole("button", { name, exact: true }).click();
    await page.getByRole("button", { name: "Evolve", exact: true }).waitFor();
    // Dev can cover several shell cycles quickly while the normal render loop still draws every frame.
    await page.evaluate(() => { if (window.__organismRig) window.__organismRig.timeScale = 8; });
    await page.waitForTimeout(2500);
    const states = [
      ["parameters", null, false],
      ["echo", "08 Echo", false],
      ["echo-overlay", "08 Echo", true],
      ["membrane-compare", "06 Membrane", true],
      ["soma-overlay", "05 Soma", true],
    ];
    for (const [state, stage, overlay] of states) {
      if (stage) {
        await page.getByRole("button", { name: new RegExp(`^${stage},`) }).click();
        const compare = page.getByRole("switch", { name: "Compare", exact: true });
        if ((await compare.getAttribute("aria-checked") === "true") !== (state === "membrane-compare")) await compare.click();
        const toggle = page.getByRole("switch", { name: /Echo shells|Light-angle bands|Bumps, dents/ });
        if ((await toggle.getAttribute("aria-checked") === "true") !== overlay) await toggle.click();
      } else await page.getByRole("tab", { name: "Parameters", exact: true }).click();
      await page.waitForTimeout(800);
      const samples = await page.evaluate(async () => {
        const source = document.querySelector("canvas");
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 32;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const rows = [], started = performance.now();
        const accelerated = !!window.__organismRig;
        // 180 consecutive rendered frames in dev; 14 real seconds in production.
        for (let frame = 0; accelerated ? frame < 180 : performance.now() - started < 14000; frame++) {
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          ctx.drawImage(source, source.width * .46, source.height * .45, source.width * .08, source.height * .10, 0, 0, 32, 32);
          const data = ctx.getImageData(0, 0, 32, 32).data;
          let sum = 0, lit = 0;
          for (let i = 0; i < data.length; i += 4) {
            const value = Math.max(data[i], data[i + 1], data[i + 2]);
            sum += value;
            if (value > 24) lit++;
          }
          rows.push({ ms: Math.round(performance.now() - started), mean: sum / 1024, lit: lit / 1024 });
        }
        return rows;
      });
      const result = { specimen, state, frames: samples.length, minMean: Math.min(...samples.map(s => s.mean)), minLit: Math.min(...samples.map(s => s.lit)), durationMs: samples.at(-1).ms };
      report.push(result);
      await writeFile(`${out}/report.json`, JSON.stringify({ backend, renderer, baseline: baseline === "--baseline", report, errors, api }, null, 2));
      assert.ok(result.minMean > 25 && result.minLit > .95, `${specimen} ${state}: body disappeared (${JSON.stringify(result)})`);
      console.log(`PASS ${specimen} ${state}: ${result.frames} frames, minimum body brightness ${result.minMean.toFixed(1)}`);
    }
  }
  assert.equal(api.length, 0, "no paid engine calls");
  assert.deepEqual(errors.filter(error => !/AudioContext|THREE\.Clock/.test(error)), []);
  console.log(`PASS temporal rendering on ${renderer}: ${report.reduce((sum, row) => sum + row.frames, 0)} sampled frames across ${report.length} states.`);
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
