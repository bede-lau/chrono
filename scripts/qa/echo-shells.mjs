/**
 * High-depth Echo visual regression. The reported failure was not a missing
 * canvas; unsorted, full-body transparent instances could obscure the body.
 * This uses a depth-12 control to cover the worst supported circuit setting.
 *
 * Requires Next dev because it deliberately exposes __organismRig in dev:
 *   node scripts/qa/echo-shells.mjs http://localhost:3000 /private/tmp/chrono-echo
 *   node scripts/qa/echo-shells.mjs http://localhost:3000 /private/tmp/chrono-echo-old --baseline
 * The second command intentionally restores the old renderer and must fail.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { webkit } from "../../deck/node_modules/playwright/index.mjs";

const [base = "http://localhost:3000", out = "/private/tmp/chrono-echo", baseline] = process.argv.slice(2);
await mkdir(out, { recursive: true });

const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1 });
const errors = [];
const api = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("request", (request) => {
  if (request.url().includes("/api/moth/")) api.push(request.url());
});

async function sample(frames) {
  return page.evaluate(async (frameCount) => {
    const source = document.querySelector("canvas");
    const sample = document.createElement("canvas");
    sample.width = sample.height = 96;
    const ctx = sample.getContext("2d", { willReadFrequently: true });
    let previous = null;
    let minBodyChroma = Infinity;
    let maxOuterGlow = 0;
    let maxFrameDelta = 0;

    for (let frame = 0; frame < frameCount; frame++) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      // Main stage only: omit the fixed UI and keep a band outside the body.
      ctx.drawImage(source, source.width * 0.19, source.height * 0.1, source.width * 0.56, source.height * 0.78, 0, 0, 96, 96);
      const data = ctx.getImageData(0, 0, 96, 96).data;
      const luma = new Uint8Array(96 * 96);
      let chroma = 0;
      let outer = 0;
      let outerCount = 0;

      for (let pixel = 0, offset = 0; offset < data.length; pixel++, offset += 4) {
        const hi = Math.max(data[offset], data[offset + 1], data[offset + 2]);
        const lo = Math.min(data[offset], data[offset + 1], data[offset + 2]);
        luma[pixel] = hi;
        const x = pixel % 96;
        const y = Math.floor(pixel / 96);
        if (x >= 22 && x < 74 && y >= 22 && y < 74) chroma += hi - lo;
        else {
          outer += hi;
          outerCount++;
        }
      }

      if (previous) {
        let delta = 0;
        for (let i = 0; i < luma.length; i++) delta += Math.abs(luma[i] - previous[i]);
        maxFrameDelta = Math.max(maxFrameDelta, delta / luma.length);
      }
      previous = luma;
      minBodyChroma = Math.min(minBodyChroma, chroma / (52 * 52));
      maxOuterGlow = Math.max(maxOuterGlow, outer / outerCount);
    }
    return { minBodyChroma, maxOuterGlow, maxFrameDelta };
  }, frames);
}

try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Create", exact: true }).waitFor();
  await page.waitForFunction(() => !!window.__organismRig);
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("dialog", { name: "Archive" }).getByRole("button", { name: "Specimen 42AC, generation 1", exact: true }).click();
  await page.getByRole("button", { name: /^08 Echo,/ }).click();

  const shells = page.getByRole("switch", { name: "Echo shells", exact: true });
  if ((await shells.getAttribute("aria-checked")) !== "false") await shells.click();
  await page.getByRole("radio", { name: "Dry", exact: true }).click();
  await page.waitForTimeout(1200);
  const dry = await sample(60);

  await page.getByRole("radio", { name: "Echo ghosts", exact: true }).click();
  await shells.click();
  await page.evaluate((useBaseline) => {
    const rig = window.__organismRig;
    rig.shellCount = 12;
    rig.shellsGeometry.instanceCount = 12;
    if (!useBaseline) return;

    const material = rig.shellsMaterial;
    material.vertexShader = material.vertexShader.replace(
      /  \/\/ Each delay tap[\s\S]*?  vA = env \* tap \* step\(aShell \+ 0\.5, n\) \* max\(uGhost \* mix\(uLEcho\.x, uLEcho\.y, s\), uShellOv \* s\);/,
      "  P *= 1.02 + ph * (0.12 + 0.42 * uShellOv);\n  vec4 mv = modelViewMatrix * vec4(P, 1.0);\n  vN = normalize(normalMatrix * d);\n  vV = normalize(-mv.xyz);\n  float env = smoothstep(0.0, 0.12, ph) * pow(1.0 - ph, 1.5);\n  vA = env * step(aShell + 0.5, n) * max(uGhost * mix(uLEcho.x, uLEcho.y, s), uShellOv * s);",
    );
    material.fragmentShader = material.fragmentShader
      .replace("float a = min(vA * (0.025 + 0.22 * rim + uShellOv * 0.25 * line), 0.12);", "float a = vA * (0.04 + 0.5 * rim + uShellOv * 0.9 * line);")
      .replace("vec3 c = dark ? vec3(0.035, 0.06, 0.12) : mix(uHue, vec3(0.8, 0.88, 1.0), 0.62) * 1.1;", "vec3 c = dark ? vec3(0.004, 0.006, 0.014) : mix(uHue, vec3(0.8, 0.88, 1.0), 0.62) * 1.3;")
      .replace("a *= dark ? 0.55 : 1.0;", "a *= dark ? 0.85 : 1.0;");
    material.blending = 1; // Three.js NormalBlending, the old order-dependent path.
    material.needsUpdate = true;
  }, baseline === "--baseline");
  await page.waitForTimeout(1000);
  const echo = await sample(180); // Covers several individual tap wraps at depth 12.
  const result = { baseline: baseline === "--baseline", dry, echo, errors, api };
  await writeFile(`${out}/report.json`, JSON.stringify(result, null, 2));

  // The Echo remains perceptible beyond the body but cannot bleach its skin.
  assert.ok(echo.maxOuterGlow > dry.maxOuterGlow + 3, `Echo halo is not distinguishable from Dry: ${JSON.stringify({ dry, echo })}`);
  assert.ok(echo.maxOuterGlow < 55, `Echo halo obscured the stage: ${JSON.stringify(echo)}`);
  assert.ok(echo.minBodyChroma > dry.minBodyChroma * 0.65, `Echo obscured body colour: ${JSON.stringify({ dry, echo })}`);
  assert.ok(echo.maxFrameDelta < 5, `Echo changed too abruptly between frames: ${JSON.stringify(echo)}`);
  assert.equal(api.length, 0, "no paid engine calls");
  assert.deepEqual(errors.filter((error) => !/AudioContext|THREE\.Clock/.test(error)), []);
  console.log(`PASS depth-12 Echo: body chroma ${echo.minBodyChroma.toFixed(1)} vs dry ${dry.minBodyChroma.toFixed(1)}, halo ${echo.maxOuterGlow.toFixed(1)}, frame delta ${echo.maxFrameDelta.toFixed(2)}.`);
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
