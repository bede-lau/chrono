/**
 * Free browser regression for the visitor-supplied Moth key. Every Atlas-proxy
 * request is intercepted: no submitted key or paid engine call leaves localhost.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { webkit } from "../../deck/node_modules/playwright/index.mjs";

const [base = "http://localhost:3002", out = "/private/tmp/chrono-key"] = process.argv.slice(2);
await mkdir(out, { recursive: true });

const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const errors = [];
const api = [];
let staleRelease;
const staleGate = new Promise((resolve) => {
  staleRelease = resolve;
});

page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

await page.route("**/api/moth/**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname;
  const authorization = request.headers().authorization;
  api.push({ method: request.method(), path, authorization: authorization ? "present" : "absent", filename: request.headers()["x-filename"] ?? null });

  if (path === "/api/moth/key/check") {
    if (authorization === "Bearer moth_qa_stale") {
      await staleGate;
      await route.fulfill({ json: { accepted: true } }).catch(() => {});
      return;
    }
    if (authorization === "Bearer moth_qa_accepted") return route.fulfill({ json: { accepted: true } });
    if (authorization === "Bearer moth_qa_rejected") return route.fulfill({ status: 401, json: { error: { type: "invalid_api_key" } } });
    if (authorization === "Bearer moth_qa_unavailable") return route.fulfill({ status: 503, json: { error: { type: "key_check_unavailable" } } });
    return route.fulfill({ status: 400, json: { error: { type: "bad_api_key" } } });
  }

  if (path === "/api/moth/assets" && request.method() === "POST") {
    const count = api.filter((entry) => entry.path === path && entry.method === "POST").length;
    return route.fulfill({ json: { asset_id: count === 1 ? "asset-key-mask" : "asset-key-skin" } });
  }
  if (/\/api\/moth\/engines\/blur-v1\/process$/.test(path) && request.method() === "POST") return route.fulfill({ json: { job_id: "qa-archive-blur" } });
  if (/\/api\/moth\/engines\/comet-qrng-v1\/process$/.test(path) && request.method() === "POST") {
    const count = api.filter((entry) => /\/engines\/comet-qrng-v1\/process$/.test(entry.path) && entry.method === "POST").length;
    return route.fulfill({ json: { job_id: count === 1 ? "qa-custom-comet" : "qa-default-comet" } });
  }
  if (/\/api\/moth\/jobs\/[^/]+\/status$/.test(path)) {
    const jobId = path.split("/").at(-2);
    return route.fulfill({ json: { job_id: jobId, engine_id: jobId === "qa-archive-blur" ? "blur-v1" : "comet-qrng-v1", status: "processing", outputs: null } });
  }
  return route.fulfill({ status: 500, json: { error: { message: "Unexpected proxy request in key QA" } } });
});

function apiFor(path) {
  return api.filter((entry) => entry.path === path);
}

try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__chrono && window.__chronoUi.getState().tab === "parameters");
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });

  const key = page.getByRole("textbox", { name: "MOTH API KEY", exact: true });
  const section = key.locator("xpath=ancestor::section[1]");
  const status = section.getByRole("status");
  const check = section.getByRole("button", { name: "Check key", exact: true });
  const clear = section.getByRole("button", { name: "Clear Moth API key", exact: true });

  assert.equal((await page.locator("body").innerText()).includes("BYOK"), false, "the old BYOK label is gone");
  assert.equal((await page.locator("body").innerText()).includes("Using your own key isn’t connected yet."), false, "the design-only disclaimer is gone");
  await expectText(status, "Using app key");
  assert.equal(await check.isDisabled(), true, "app-key mode does not need a visitor check");

  // Rejected and unavailable are distinct, recoverable results.
  await key.fill("moth_qa_rejected");
  await check.click();
  await expectText(status, "Key rejected. Check it and try again.");
  assert.equal(await key.getAttribute("aria-invalid"), "true");
  await key.fill("moth_qa_unavailable");
  await check.click();
  await expectText(status, "Couldn’t check the key. Try again.");

  // An edited but unchecked key blocks Create before it can upload or submit anything.
  const runPostsBeforeUnchecked = api.filter((entry) => entry.method === "POST" && (entry.path === "/api/moth/assets" || entry.path.includes("/engines/"))).length;
  await key.fill("moth_qa_unchecked");
  await page.locator("[data-primary-action]").click();
  await page.getByText("Check your Moth key", { exact: true }).waitFor();
  const runPostsAfterUnchecked = api.filter((entry) => entry.method === "POST" && (entry.path === "/api/moth/assets" || entry.path.includes("/engines/"))).length;
  assert.equal(runPostsAfterUnchecked, runPostsBeforeUnchecked, "an unchecked key cannot upload or submit a run");

  // An old accepted response may not bless a changed key or a cleared field.
  await key.fill("moth_qa_stale");
  await check.click();
  await expectText(status, "Checking key…");
  await key.fill("moth_qa_changed");
  staleRelease();
  await page.waitForTimeout(120);
  await expectText(status, "Check this key before using it.");
  assert.equal((await status.textContent()).includes("Accepted"), false, "a stale check cannot accept a new key");
  await clear.click();
  assert.equal(await key.inputValue(), "");
  await expectText(status, "Using app key");

  // A successfully checked key survives remounting the panel, but never browser storage.
  await key.fill("moth_qa_accepted");
  await check.click();
  await expectText(status, "Accepted · Used for Create and Evolve");
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/key-accepted.png` });
  await page.getByRole("tab", { name: "Evolution", exact: true }).click();
  await page.getByRole("tab", { name: "Parameters", exact: true }).click();
  await key.waitFor();
  assert.equal(await key.inputValue(), "moth_qa_accepted", "session value survives Parameters remount");
  const persisted = await page.evaluate(() => {
    const containsDummy = (storage) => Object.values(storage).some((value) => String(value).includes("moth_qa_"));
    return { local: containsDummy(localStorage), session: containsDummy(sessionStorage), cookie: document.cookie.includes("moth_qa_") };
  });
  assert.deepEqual(persisted, { local: false, session: false, cookie: false }, "visitor keys never persist in browser storage or cookies");

  // An archive evolved under a checked visitor key re-uploads its skin to that key's account before Blur.
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("dialog", { name: "Archive" }).getByRole("button", { name: "Specimen 42AC, generation 1", exact: true }).click();
  await page.getByRole("button", { name: "Evolve", exact: true }).click();
  await page.waitForFunction(() => window.__chrono.getState().runs.decoherence?.status === "queued");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.waitForFunction(() => window.__chronoUi.getState().running === null && window.__chrono.getState().mode === "idle");
  const archivePosts = api.filter((entry) => entry.method === "POST" && (entry.path === "/api/moth/assets" || entry.path.endsWith("/blur-v1/process")));
  assert.deepEqual(archivePosts.map((entry) => entry.authorization), ["present", "present", "present"], "archive mask, skin, and Blur use the checked key");
  assert.ok(archivePosts[0].filename?.includes("mask"), "mask uploads first");
  assert.ok(archivePosts[1].filename?.includes("skin"), "archive skin is re-uploaded before Blur");
  assert.equal(await page.evaluate(() => window.__chrono.getState().specimen?.skin?.assetId), "asset-key-skin", "the specimen records the replacement skin asset");

  // A real Create path snapshots the checked key and sends it only to the same-origin proxy.
  await page.getByRole("button", { name: "New specimen", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.waitForFunction(() => window.__chrono.getState().runs.genesis?.status === "queued");
  assert.equal(await page.evaluate(() => JSON.stringify({ state: window.__chrono.getState(), log: window.__chrono.getState().log }).includes("moth_qa_accepted")), false, "state and log never serialize the visitor key");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.waitForFunction(() => window.__chronoUi.getState().running === null && window.__chrono.getState().mode === "idle");
  const customCreate = apiFor("/api/moth/engines/comet-qrng-v1/process")[0];
  assert.equal(customCreate?.authorization, "present", "checked key is attached to the Create proxy request");

  // A retained job is bound to its original checked key. Clearing blocks Resume before another job poll,
  // while restoring and checking that key reconnects to the exact same remote job without resubmitting.
  await page.getByRole("tab", { name: "Parameters", exact: true }).click();
  await clear.click();
  const retainedJobGets = api.filter((entry) => entry.path === "/api/moth/jobs/qa-custom-comet/status").length;
  const retainedRunPosts = api.filter((entry) => entry.method === "POST" && (entry.path === "/api/moth/assets" || entry.path.includes("/engines/"))).length;
  const resume = page.locator('[data-primary-action][aria-label="Resume"]');
  await resume.click();
  await page.getByText("Use this run’s original key", { exact: true }).waitFor();
  assert.equal(api.filter((entry) => entry.path === "/api/moth/jobs/qa-custom-comet/status").length, retainedJobGets, "wrong credentials cannot poll a retained job");
  assert.equal(api.filter((entry) => entry.method === "POST" && (entry.path === "/api/moth/assets" || entry.path.includes("/engines/"))).length, retainedRunPosts, "wrong credentials cannot upload or submit while resuming");
  await key.fill("moth_qa_accepted");
  await check.click();
  await expectText(status, "Accepted · Used for Create and Evolve");
  await resume.click();
  await page.waitForFunction(() => window.__chrono.getState().runs.genesis?.status === "queued");
  await page.waitForTimeout(1100); // Atlas polling intentionally starts after one second.
  assert.equal(await page.evaluate(() => window.__chrono.getState().runs.genesis?.jobId), "qa-custom-comet", "Resume keeps the original remote job id");
  assert.ok(api.filter((entry) => entry.path === "/api/moth/jobs/qa-custom-comet/status").length > retainedJobGets, "original key resumes by polling the retained job");
  assert.equal(api.filter((entry) => entry.method === "POST" && (entry.path === "/api/moth/assets" || entry.path.includes("/engines/"))).length, retainedRunPosts, "Resume does not submit a duplicate run");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.waitForFunction(() => window.__chronoUi.getState().running === null && window.__chrono.getState().mode === "idle");

  // Clear returns to server-configured credentials, so the next Create proxy request has no visitor Authorization header.
  await page.getByRole("tab", { name: "Parameters", exact: true }).click();
  await clear.click();
  await expectText(status, "Using app key");
  await page.getByRole("button", { name: "New specimen", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.waitForFunction(() => window.__chrono.getState().runs.genesis?.status === "queued");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.waitForFunction(() => window.__chronoUi.getState().running === null && window.__chrono.getState().mode === "idle");
  const defaultCreate = apiFor("/api/moth/engines/comet-qrng-v1/process")[1];
  assert.equal(defaultCreate?.authorization, "absent", "clearing does not send an empty or stale visitor key");

  // A browser reload resets the in-memory key state.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__chrono && window.__chronoUi.getState().tab === "parameters");
  const reloadedKey = page.getByRole("textbox", { name: "MOTH API KEY", exact: true });
  assert.equal(await reloadedKey.inputValue(), "", "reload clears the visitor key");
  await expectText(reloadedKey.locator("xpath=ancestor::section[1]").getByRole("status"), "Using app key");

  // WebKit reports the deliberately mocked rejected/unavailable HTTP responses as console errors.
  // They are the states this journey is proving; every other browser error remains a failure.
  const expectedHttpErrors = errors.filter((error) => /server responded with a status of (401|503)/.test(error));
  const unexpectedErrors = errors.filter((error) => !expectedHttpErrors.includes(error));
  assert.deepEqual(unexpectedErrors, [], "no unexpected browser errors from key verification or run setup");
  const summary = {
    checks: ["rejected", "unavailable", "unchecked blocks runs", "stale ignored", "accepted", "panel remount", "no storage", "archive skin re-upload", "custom Create authorization", "serialized state clean", "wrong-key resume blocked", "original-key Resume same job", "clear default authorization", "reload clears"],
    api: api.map(({ method, path, authorization, filename }) => ({ method, path, authorization, filename: filename?.replace(/moth_[^\s]+/g, "[redacted]") ?? null })),
    expectedHttpErrors,
    unexpectedErrors,
  };
  await writeFile(`${out}/report.json`, JSON.stringify(summary, null, 2));
  console.log("PASS key browser QA: checked session key, guarded Create/Resume, stale-response guard, no persistence, archive re-upload, custom/default proxy authorization");
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}

async function expectText(locator, expected) {
  await locator.filter({ hasText: expected }).waitFor();
}
