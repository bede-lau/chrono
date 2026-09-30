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
 *   await t.close();
 *
 * `t.page` is a normal Playwright Page (click, keyboard, locator, evaluate, ...).
 * In dev builds the stores are exposed: `window.__chrono` (shared store) and `window.__chronoUi` (UI store).
 */
import { chromium } from "../../deck/node_modules/playwright/index.mjs";

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
  page.on("pageerror", (e) => errors.push("[pageerror] " + String(e).slice(0, 300)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("[console.error] " + m.text().slice(0, 300));
  });
  page.on("requestfailed", (r) => errors.push("[requestfailed] " + r.url().slice(0, 140)));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  if (settleMs) await page.waitForTimeout(settleMs);

  return {
    page,
    errors,
    browser,
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
