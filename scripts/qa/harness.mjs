/**
 * Headless-browser QA harness (no browser extension needed).
 *
 * Uses the Playwright install in ./deck (run `cd deck && npm install` once if it is missing).
 * WebGL runs on SwiftShader, so expect ~2-4 fps: fine for judging composition, colour and layout, not for timing.
 *
 *   import { open } from "../../scripts/qa/harness.mjs";
 *   const t = await open({ url: "http://localhost:3101", width: 1600, height: 1000 });
 *   await t.shot("/tmp/out");             // writes /tmp/out.png
 *   console.log(await t.lit());           // { litPct, ... }  => is the WebGL canvas actually drawing?
 *   console.log(t.errors);                // page errors, console.error, failed requests
 *   await t.waitFor(() => window.__chrono.getState().specimen !== null); // wait for app state without fixed sleeps
 *   await t.close();
 *
 * `t.page` is a normal Playwright Page (click, keyboard, locator, evaluate, ...).
 * In dev builds the stores are exposed: `window.__chrono` (shared store) and `window.__chronoUi` (UI store).
 */
import { chromium } from "../../deck/node_modules/playwright/index.mjs";

/** Only a completed live chain can excuse Atlas' documented seed-content rejection/re-tint fallback. */
export function classifyFailures(errors, httpFailures, completedLiveChain = false) {
  const recovered = httpFailures.filter(r => completedLiveChain && r.method === "POST" && r.path === "/api/moth/assets" && r.status === 422 && /-seed(?:-t\d+)?\.png$/.test(r.filename) && /not a valid asset/i.test(r.message));
  let remaining = recovered.length;
  const unexpectedErrors = errors.filter(e => {
    if (/AudioContext|GL Driver|THREE\.Clock/.test(e)) return false;
    if (remaining > 0 && /^\[console\.error\] Failed to load resource:.*\b422\b.* @ https?:\/\/[^/]+\/api\/moth\/assets$/.test(e)) {
      remaining--;
      return false;
    }
    return true;
  });
  return { unexpectedErrors, unexpectedHttp: httpFailures.filter(r => !recovered.includes(r)), recovered };
}

export async function open({ url, width = 1600, height = 1000, dpr = 1.5, settleMs = 9000, mobile = false } = {}) {
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
  });
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dpr,
    ...(mobile ? { hasTouch: true, isMobile: true } : {}),
  });
  const page = await ctx.newPage();
  const errors = [];
  const httpFailures = [];
  const responseChecks = [];
  /** Every /api/moth/* request from the very first byte of page load: `${method} ${path}`. */
  const api = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/moth/")) api.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  page.on("pageerror", (e) => errors.push("[pageerror] " + String(e).slice(0, 300)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("[console.error] " + m.text().slice(0, 300) + " @ " + m.location().url);
  });
  page.on("response", r => {
    if (r.status() < 400) return;
    responseChecks.push((async () => {
      const body = await r.json().catch(() => null);
      httpFailures.push({ path: new URL(r.url()).pathname, method: r.request().method(), status: r.status(), filename: r.request().headers()["x-filename"] ?? "", message: body?.error?.message ?? "" });
    })());
  });
  page.on("requestfailed", (r) => errors.push("[requestfailed] " + r.url().slice(0, 140)));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  // Next's development-only launcher overlaps mobile controls; it is absent in production.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  if (settleMs) await page.waitForTimeout(settleMs);

  return {
    page,
    errors,
    httpFailures,
    settleResponses: () => Promise.all(responseChecks),
    api,
    browser,
    /** Wait for a browser predicate, useful for app/store transitions without fixed sleeps. */
    waitFor: (predicate, arg = null, timeout = 5000) => page.waitForFunction(predicate, arg, { timeout }),
    /** Screenshot to `${path}.png`. */
    shot: (path, opts = {}) => page.screenshot({ path: `${path}.png`, ...opts }),
    /** Fraction of the WebGL canvas that is lit (> 24/255): a blank stage reads ~0. */
    lit: () =>
      page.evaluate(() => {
        const c = document.querySelector("canvas");
        if (!c) return { canvas: false };
        const o = document.createElement("canvas");
        o.width = 160;
        o.height = 100;
        const g = o.getContext("2d");
        g.drawImage(c, 0, 0, 160, 100);
        const d = g.getImageData(0, 0, 160, 100).data;
        let lit = 0;
        for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) > 24) lit++;
        return { canvas: true, litPct: +((100 * lit) / 16000).toFixed(1) };
      }),
    close: () => browser.close(),
  };
}
