/** Free browser regression for user feedback. All Atlas requests are intercepted. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { webkit } from "../../deck/node_modules/playwright/index.mjs";

const [base = "http://localhost:3002", out = "/private/tmp/chrono-feedback"] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const errors = [], requests = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const bytes = await readFile(new URL("../../public/specimens/42ac05-g1/echo.wav", import.meta.url));
const jobId = "43bb9204-0426-403a-8f09-d5acc91e3ad3";
const output = { slot: "result", output_asset_id: "mock-echo-output", content_type: "audio/wav", filename: "echo.wav", size_bytes: bytes.length };
let processing = false;
await page.route("**/api/moth/**", async (route) => {
  const r = route.request(), path = new URL(r.url()).pathname;
  requests.push(`${r.method()} ${path}`);
  if (path.endsWith(`/jobs/${jobId}/status`)) return route.fulfill({ json: { job_id: jobId, engine_id: "retrocausal-echo-v1", status: processing ? "processing" : "completed", outputs: processing ? null : [output] } });
  if (path.endsWith(`/jobs/${jobId}/result`)) return route.fulfill({ json: { outputs: [output] } });
  if (path.endsWith("/assets/mock-echo-output/download")) return route.fulfill({ contentType: "audio/wav", body: bytes });
  return route.fulfill({ status: 500, json: { error: { message: "Unexpected API request in free QA" } } });
});

try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__organismRig && window.__chrono.getState().fps > 0);
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  const key = page.getByLabel("MOTH API KEY", { exact: true }).and(page.locator("input"));
  await key.fill("qa-dummy-key");
  assert.equal(await key.getAttribute("type"), "password");
  await page.getByRole("button", { name: "Show Moth API key", exact: true }).click();
  assert.equal(await key.getAttribute("type"), "text");
  await page.getByRole("button", { name: "Hide Moth API key", exact: true }).click();
  await page.getByRole("button", { name: "Clear Moth API key", exact: true }).click();
  assert.equal(await key.inputValue(), "");
  assert.equal(requests.length, 0, "key design must not make API calls");

  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("dialog", { name: "Archive" }).getByRole("button", { name: "Specimen 42AC, generation 1", exact: true }).click();
  await page.getByRole("button", { name: "Evolve", exact: true }).waitFor();
  await page.waitForTimeout(1600);
  const budget = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    return { width: canvas.width, cssWidth: canvas.clientWidth, fps: window.__chrono.getState().fps };
  });
  assert.ok(budget.width <= budget.cssWidth * 1.5 + 1, "DPR is capped at 1.5 on a Retina viewport");
  assert.ok(budget.fps > 0 && budget.fps <= 32, "rendering is bounded near 30fps");
  await page.getByRole("button", { name: "Pulse specimen", exact: true }).click();
  await page.waitForFunction(() => window.__organismRig.material.uniforms.uMembranePulse.value > 0);
  assert.equal(await page.evaluate(() => window.__chrono.getState().pendingWounds.length), 0, "Pulse leaves no wound");
  await page.mouse.click(620, 370);
  await page.waitForFunction(() => window.__chrono.getState().pendingWounds.length === 1);
  await page.getByRole("status").filter({ hasText: "1 touch · Evolve to age" }).waitFor();

  // Simulate the browser visibility notification and verify all manual visual clocks stop and resume.
  const pausedTime = await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    return window.__organismRig.time;
  });
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => window.__organismRig.time), pausedTime, "hidden render clock is stopped");
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForFunction((t) => window.__organismRig.time > t, pausedTime);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Capture PNG", exact: true }).click();
  const download = await downloadPromise;
  await download.saveAs(`${out}/capture.png`);
  assert.ok((await readFile(`${out}/capture.png`)).length > 10_000, "captured PNG contains the rendered specimen");
  await page.waitForTimeout(1000); // Let the capture flash fade before saving the review screenshot.
  await page.screenshot({ path: `${out}/preview.png` });

  async function interruptedEcho() {
    await page.evaluate((id) => {
      const st = window.__chrono.getState();
      const runs = { ...st.runs, echo: { id: "echo", status: "failed", attempt: 1, jobId: id, startedAt: Date.now() - 360_000, errorType: "client_timeout", error: "Still processing after 360 s" } };
      window.__chrono.setState({ specimen: { ...st.specimen, echo: undefined, wounds: [...st.pendingWounds], runs }, runs });
    }, jobId);
  }
  await interruptedEcho();
  const resumeButton = page.locator('[data-primary-action][aria-label="Resume"]');
  await resumeButton.waitFor();
  await page.getByRole("button", { name: /^08 Echo,/ }).click();
  await page.getByText("Waiting on Atlas", { exact: true }).waitFor();
  await page.screenshot({ path: `${out}/echo-resume.png` });
  await resumeButton.click();
  await page.waitForFunction(() => window.__chrono.getState().runs.echo.status === "done");
  assert.equal(await page.evaluate(() => window.__chrono.getState().runs.echo.jobId), jobId);
  assert.equal(await page.evaluate(() => window.__chrono.getState().pendingWounds.length), 0, "resumed Evolve consumes its applied touch");

  // Stop is a local pause, so reconnecting must still use the same remote job.
  processing = true;
  await interruptedEcho();
  await resumeButton.click();
  await page.waitForFunction(() => window.__chrono.getState().runs.echo.status === "queued");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await resumeButton.waitFor();
  processing = false;
  await resumeButton.click();
  await page.waitForFunction(() => window.__chrono.getState().runs.echo.status === "done");
  assert.ok(requests.every((r) => r.startsWith("GET ")), "all recovery calls read the retained job; no submissions/uploads");
  assert.deepEqual(errors.filter((e) => !/AudioContext|THREE\.Clock/.test(e)), []);
  await writeFile(`${out}/report.json`, JSON.stringify({ budget, requests, errors, checks: "key, pulse, touch, hidden resume, capture, Echo resume and Stop recovery" }, null, 2));
  console.log("PASS feedback browser QA: key controls, non-wounding Pulse, touch, Retina budget, hidden resume, PNG capture, Echo Resume, Stop→Resume; 0 paid submissions");
} catch (e) {
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  throw e;
} finally {
  await browser.close();
}
