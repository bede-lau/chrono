/**
 * End-to-end user journey against a running server (dev handle `window.__chrono` required, i.e. `next dev`).
 *
 *   node scripts/qa/e2e.mjs <baseUrl> <outDir> [--live]
 *
 * Without --live: NO Atlas credits are spent. It checks the new-visitor start state, real panel/lens/probe controls,
 * follow mode, New specimen reset, responsive mobile sheet and wound-click behaviour using an archived specimen.
 * With --live: presses Create, waits for all 8 real engines, clicks wounds at known positions, verifies the wound mask
 * matches those positions, then presses Evolve and waits for the 5 downstream engines (~30 credits, 4-15 min).
 */
import { mkdirSync } from "node:fs";
import { classifyFailures, open } from "./harness.mjs";

const [base = "http://localhost:3000", out = "/private/tmp/chrono-e2e"] = process.argv.slice(2);
const LIVE = process.argv.includes("--live");
mkdirSync(out, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const t = await open({ url: base, width: 1280, height: 800, dpr: 1, settleMs: 11000 });
const { page } = t;
let completedCreate = false;
let completedEvolve = false;
try {
const snap = () =>
  page.evaluate(() => {
    const s = window.__chrono.getState();
    return {
      hasSpecimen: !!s.specimen,
      mode: s.mode,
      active: s.activeStage,
      selected: s.selectedStage,
      runs: Object.fromEntries(Object.entries(s.runs).map(([k, v]) => [k, v.status])),
      wounds: s.pendingWounds,
      lens: s.lens,
      gen: s.specimen?.generation ?? null,
    };
  });
const primaryLabel = async () =>
  (await page.locator("[data-primary-action]").first().getAttribute("aria-label").catch(() => "?")) || "?";
const waitForStore = (predicate, timeout = 5000, arg = null) => t.waitFor(predicate, arg, timeout);
const uiSnap = () => page.evaluate(() => ({ tab: window.__chronoUi.getState().tab, panel: window.__chronoUi.getState().panel, follow: window.__chronoUi.getState().follow }));

/* ------------------------------------------------------------- 1. new visitor */
await t.shot(`${out}/01-first-load`);
let s = await snap();
check("first load: no specimen", !s.hasSpecimen);
check("first load: all 8 stages idle", Object.values(s.runs).every((v) => v === "idle") || Object.keys(s.runs).length === 0);
check("first load: nothing auto-started (no Atlas request)", t.api.length === 0, t.api.join(", "));
check("first load: primary button reads Create", /^Create/.test(await primaryLabel()), await primaryLabel());
check("first load: primary action is accessible", await page.getByRole("button", { name: "Create" }).count() > 0);
check("first load: WebGL embryo is drawing", (await t.lit()).litPct > 0.5, JSON.stringify(await t.lit()));

/* ------------------------------------------------------------- 2. real panel navigation (no specimen) */
await page.getByRole("tab", { name: "Evolution" }).click();
await waitForStore(() => window.__chronoUi.getState().tab === "evolution");
check("Evolution tab opens its documentation view", await page.locator('[data-evolution-stage="genesis"]').count() === 1);
await page.getByRole("tab", { name: "Parameters" }).click();
await waitForStore(() => window.__chronoUi.getState().tab === "parameters");
await page.getByRole("button", { name: /04 Decoherence: open engine/ }).first().click();
await waitForStore(() => window.__chronoUi.getState().tab === "evolution" && window.__chrono.getState().selectedStage === "decoherence");
check("parameter stage link switches directly to its Evolution view", (await uiSnap()).tab === "evolution" && (await snap()).selected === "decoherence");
await page.keyboard.press("Escape");
await waitForStore(() => window.__chronoUi.getState().tab === "parameters");
for (const k of ["1", "4", "5", "6"]) {
  await page.keyboard.press(k);
  const keyboardStage = ({1:"genesis",4:"decoherence",5:"soma",6:"membrane"})[k];
  await waitForStore((stage) => window.__chrono.getState().selectedStage === stage, 5000, keyboardStage);
  check(`key ${k} selects ${keyboardStage}`, (await snap()).selected === keyboardStage);
  await t.shot(`${out}/02-evolution-${k}-nospecimen`);
}
s = await snap();
check("key 6 immediately selects stage 06", s.selected === "membrane" && (await uiSnap()).tab === "evolution", String(s.selected));
// The rail is a real UI path as well as the keyboard shortcut.
await page.getByRole("button", { name: /^05 Soma/ }).click();
await waitForStore(() => window.__chrono.getState().selectedStage === "soma");
check("stage rail opens the selected Evolution view", (await snap()).selected === "soma");
await page.keyboard.press("Escape");
await waitForStore(() => window.__chronoUi.getState().tab === "parameters");
s = await snap();
check("Esc returns to Parameters and clears the lens", s.lens.stage === null && (await uiSnap()).tab === "parameters", JSON.stringify(s.lens));

if (!LIVE) {
  /* ------------------------------------------------------------- 3. archived specimen (free) */
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("dialog", { name: "Archive" }).getByRole("button", { name: "Specimen 42AC, generation 1", exact: true }).click();
  await waitForStore(() => window.__chrono.getState().specimen?.id === "42ac05-g1");
  await page.waitForTimeout(6000);
  check("after loading an archived specimen the button reads Evolve", /^Evolve/.test(await primaryLabel()), await primaryLabel());
  await t.shot(`${out}/03-archived`);
} else {
  /* ------------------------------------------------------------- 3. LIVE create */
  console.log("LIVE: pressing Create …");
  const t0 = Date.now();
  await page.getByRole("button", { name: /^Create/ }).first().click();
  let last = "";
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    await page.waitForTimeout(4000);
    s = await snap();
    const line = `${((Date.now() - t0) / 1000).toFixed(0)}s mode=${s.mode} active=${s.active} ${Object.entries(s.runs).map(([k, v]) => `${k[0]}${k[1]}:${v[0]}`).join(" ")}`;
    if (line !== last) console.log("  " + line);
    last = line;
    for (const [k, v] of Object.entries(s.runs)) if (v === "done" && !seen.has(k)) { seen.add(k); await t.shot(`${out}/04-create-${k}`); }
    if (s.mode === "idle" && i > 3) break;
  }
  s = await snap();
  const done = Object.values(s.runs).filter((v) => v === "done").length;
  completedCreate = done === 8;
  check("Create ran all 8 engines", done === 8, `${done}/8 done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  check("after Create the button reads Evolve", /^Evolve/.test(await primaryLabel()), await primaryLabel());
  await t.shot(`${out}/05-created`);
}

/* ------------------------------------------------------------- 4. wounds at known places + mask agreement */
const box = await page.evaluate(() => {
  const c = document.querySelector("canvas").getBoundingClientRect();
  return { x: c.x, y: c.y, w: c.width, h: c.height };
});
// The blob is centred; probe a point near its top, its left-middle and its bottom-right.
const cx = box.x + box.w / 2, cy = box.y + box.h / 2, r = Math.min(box.w, box.h) * 0.22;
const clicks = [[cx, cy - r * 0.8], [cx - r * 0.7, cy + r * 0.1], [cx + r * 0.5, cy + r * 0.7]];
await page.evaluate(() => window.__chrono.getState().clearWounds());
for (const [x, y] of clicks) {
  await page.mouse.click(x, y);
  await page.waitForTimeout(700);
}
s = await snap();
check("3 clicks → 3 pending wounds", s.wounds.length === 3, `${s.wounds.length}`);
if (s.wounds.length === 3) {
  const [top, mid, bot] = s.wounds;
  check("wound v follows the convention (top click has larger v than bottom click; v=1 = north)", top.v > mid.v && mid.v > bot.v - 0.05 && top.v > bot.v, `v: top ${top.v.toFixed(2)} mid ${mid.v.toFixed(2)} bottom ${bot.v.toFixed(2)}`);
}
await t.shot(`${out}/06-wounds`);

if (LIVE) {
  console.log("LIVE: pressing Evolve …");
  const t1 = Date.now();
  await page.getByRole("button", { name: /^Evolve/ }).first().click();
  let last = "";
  for (let i = 0; i < 300; i++) {
    await page.waitForTimeout(4000);
    s = await snap();
    const line = `${((Date.now() - t1) / 1000).toFixed(0)}s mode=${s.mode} active=${s.active} gen=${s.gen}`;
    if (line !== last) console.log("  " + line);
    last = line;
    if (s.mode === "idle" && i > 2) break;
  }
  s = await snap();
  completedEvolve = ["decoherence", "soma", "membrane", "voice", "echo"].every(stage => s.runs[stage] === "done");
  check("Evolve advanced the generation", s.gen === 1, `gen ${s.gen}`);
  check("Evolve completed all five downstream engines", ["decoherence", "soma", "membrane", "voice", "echo"].every(stage => s.runs[stage] === "done"), JSON.stringify(s.runs));
  check("Evolve reused the first three stages", ["genesis", "colony", "morphogenesis"].every(stage => s.runs[stage] === "cached"));
  // mask really encodes the wounds where they were clicked
  const m = await page.evaluate(async () => {
    const sp = window.__chrono.getState().specimen;
    if (!sp?.mask?.url) return null;
    const img = new Image();
    img.src = sp.mask.url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const at = (u, v) => d[(Math.min(c.height - 1, Math.floor((1 - v) * c.height)) * c.width + Math.min(c.width - 1, Math.floor(u * c.width))) * 4];
    let base = 255;
    for (let i = 0; i < d.length; i += 4) base = Math.min(base, d[i]);
    return { w: c.width, h: c.height, base, wounds: sp.wounds.map((w) => ({ ...w, val: at(w.u, w.v), flipped: at(w.u, 1 - w.v) })) };
  });
  if (m) {
    for (const w of m.wounds) check(`mask is hot exactly at wound (u ${w.u.toFixed(2)}, v ${w.v.toFixed(2)})`, w.val > m.base + 60 && w.val >= w.flipped, `at wound ${w.val}, at mirrored spot ${w.flipped}, baseline ${m.base}`);
  } else check("mask artifact present after Evolve", false);
  await t.shot(`${out}/07-evolved`);
}

/* ------------------------------------------------------------- 5. actual lens controls + linked probe */
const lensCases = [
  ["4", "decoherence", "Fresh skin", "Aged + scarred", "Wound heat"],
  ["5", "soma", "Smooth sphere", "Warped body", "Bumps, dents + links"],
  ["6", "membrane", "Matte tissue", "Iridescent", "Light-angle bands"],
];
for (const [key, stage, without, withIt, overlay] of lensCases) {
  await page.keyboard.press(key);
  await waitForStore((expected) => window.__chrono.getState().selectedStage === expected, 5000, stage);
  check(`stage ${key} selects ${stage} in the UI`, (await snap()).selected === stage);
  const group = page.getByRole("radiogroup", { name: "Chrono Lens" });
  await group.getByRole("radio", { name: without }).click();
  await waitForStore(() => window.__chrono.getState().lens.amount === 0);
  check(`${stage}: Without button changes lens state`, (await snap()).lens.amount === 0);
  await page.waitForTimeout(2000);
  await t.shot(`${out}/08-lens-${stage}-without`);
  await group.getByRole("radio", { name: withIt }).click();
  await waitForStore(() => window.__chrono.getState().lens.amount === 1);
  check(`${stage}: With button changes lens state`, (await snap()).lens.amount === 1);
  await page.waitForTimeout(2000);
  await t.shot(`${out}/08-lens-${stage}-with`);
  const compare = page.getByRole("switch", { name: "Compare" });
  await compare.click();
  await waitForStore(() => window.__chrono.getState().lens.compare === true);
  check(`${stage}: Compare switch updates the lens`, (await snap()).lens.compare);
  await page.waitForTimeout(2000);
  await t.shot(`${out}/08-lens-${stage}-compare`);
  await compare.click();
  const overlaySwitch = page.getByRole("switch", { name: overlay });
  const overlayBefore = (await overlaySwitch.getAttribute("aria-checked")) === "true";
  await overlaySwitch.click();
  await waitForStore((initial) => window.__chrono.getState().lens.overlay !== initial, 5000, overlayBefore);
  check(`${stage}: diagnostic overlay switch updates the lens`, (await snap()).lens.overlay !== overlayBefore);
  await overlaySwitch.click();
  await t.shot(`${out}/08-lens-${stage}-ui`);
}
// Soma exposes multiple image-space previews, so its linked crosshair can be checked on a sibling artifact.
await page.keyboard.press("5");
await waitForStore(() => window.__chrono.getState().selectedStage === "soma");
const frames = page.locator("#chrono-panel-view .cursor-crosshair");
if (await frames.count() > 0) {
  await frames.first().hover({ position: { x: 12, y: 18 } });
  await waitForStore(() => window.__chrono.getState().probe?.source === "panel");
  const probe = await page.evaluate(() => window.__chrono.getState().probe);
  const crosshairVisible = await page.locator("#chrono-panel-view .cursor-crosshair svg g").evaluateAll((groups) => groups.some((g) => getComputedStyle(g).display !== "none"));
  check("artifact hover publishes a linked panel probe", probe?.source === "panel" && probe.u >= 0 && probe.u <= 1 && probe.v >= 0 && probe.v <= 1);
  check("linked probe is drawn on another artifact preview", crosshairVisible);
  await page.mouse.move(8, 8);
  await waitForStore(() => window.__chrono.getState().probe === null);
  check("linked probe clears when the pointer leaves", await page.evaluate(() => window.__chrono.getState().probe === null));
} else {
  check("artifact preview is available for linked-probe interaction", false);
}

/* ------------------------------------------------------------- 6. follow mode and manual pinning (store-injected; no API) */
await page.evaluate(() => {
  const st = window.__chrono.getState();
  st.setMode("idle", null);
  st.selectStage(null);
  window.__chronoUi.getState().setTab("parameters");
  st.setRun("decoherence", { status: "running", attempt: 1 });
  st.setMode("evolving", "decoherence");
});
await waitForStore(() => window.__chronoUi.getState().follow && window.__chronoUi.getState().tab === "evolution" && window.__chrono.getState().selectedStage === "decoherence");
check("Evolution follows an injected active stage", (await uiSnap()).follow && (await snap()).selected === "decoherence");
await page.evaluate(() => window.__chrono.getState().setMode("evolving", "soma"));
await waitForStore(() => window.__chrono.getState().selectedStage === "soma");
check("follow mode tracks the next active engine", (await snap()).selected === "soma");
await page.getByRole("button", { name: /^06 Membrane/ }).click();
await waitForStore(() => !window.__chronoUi.getState().follow && window.__chrono.getState().selectedStage === "membrane");
await page.evaluate(() => window.__chrono.getState().setMode("evolving", "decoherence"));
await page.waitForTimeout(100);
check("manual stage choice ends follow mode for the run", !(await uiSnap()).follow && (await snap()).selected === "membrane");
await page.evaluate(() => window.__chrono.getState().setMode("idle", null));
await page.keyboard.press("Escape");

/* ------------------------------------------------------------- 7. New specimen reset, retained controls, no API */
await page.keyboard.press("Escape");
await waitForStore(() => window.__chronoUi.getState().tab === "parameters");
const entanglement = page.getByRole("slider", { name: "Entanglement" }).first();
await entanglement.focus();
const beforeEntanglement = await page.evaluate(() => window.__chrono.getState().controls.entanglement);
await entanglement.press("ArrowRight");
await waitForStore((before) => window.__chrono.getState().controls.entanglement !== before, 5000, beforeEntanglement);
const changedEntanglement = await page.evaluate(() => window.__chrono.getState().controls.entanglement);
await page.getByRole("button", { name: "Unmute audio", exact: true }).click();
await waitForStore(() => window.__chrono.getState().audioLevel > 0.0001, 10000);
check("the archived or created specimen produces audio when enabled", await page.evaluate(() => window.__chrono.getState().audioLevel > 0.0001));
const apiBeforeNew = t.api.length;
await page.getByRole("button", { name: "New specimen" }).click();
await waitForStore(() => window.__chrono.getState().specimen === null);
s = await snap();
check("New specimen returns to blank state", !s.hasSpecimen && /^Create/.test(await primaryLabel()));
check("New specimen keeps changed controls", Math.abs((await page.evaluate(() => window.__chrono.getState().controls.entanglement)) - changedEntanglement) < 1e-6);
await waitForStore(() => window.__chrono.getState().audioLevel < 0.00001, 10000);
check("New specimen stops old audio and keeps the sound preference", await page.evaluate(() => window.__chrono.getState().audioEnabled && window.__chrono.getState().audioLevel < 0.00001));
check("New specimen reset makes no Moth API calls", t.api.length === apiBeforeNew, t.api.slice(apiBeforeNew).join(", "));
if (!LIVE) check("free UI journey made no Moth API calls", t.api.length === 0, t.api.join(", "));

/* ------------------------------------------------------------- 8. mobile sheet, rail and overflow */
await page.setViewportSize({ width: 390, height: 844 });
await waitForStore(() => window.__chronoUi.getState().mobile === true, 8000);
await t.shot(`${out}/09-mobile-blank`);
const widths = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
check("mobile 390×844 has no horizontal overflow", Math.max(widths.document, widths.body) <= widths.viewport, JSON.stringify(widths));
check("mobile primary Create action is accessible", await page.getByRole("button", { name: "Create" }).first().isVisible());
const panelToggle = page.getByRole("button", { name: "Parameters and evolution" });
await panelToggle.click();
await waitForStore(() => window.__chronoUi.getState().panel === "sheet");
check("mobile panel toggle opens the bottom sheet", (await uiSnap()).panel === "sheet");
await page.getByRole("tab", { name: "Evolution" }).click();
await waitForStore(() => window.__chronoUi.getState().tab === "evolution");
await page.getByRole("dialog", { name: "Specimen panel" }).getByRole("button", { name: "Close", exact: true }).click();
await waitForStore(() => window.__chronoUi.getState().panel === null);
await page.getByRole("button", { name: /^06 Membrane/ }).click();
await waitForStore(() => window.__chrono.getState().selectedStage === "membrane");
check("mobile rail selection opens the Evolution sheet", (await uiSnap()).panel === "sheet" && (await snap()).selected === "membrane");
await page.getByRole("tab", { name: "Parameters" }).click();
await waitForStore(() => window.__chronoUi.getState().tab === "parameters");
check("mobile Parameters/Evolution tabs switch", (await uiSnap()).tab === "parameters");
await t.shot(`${out}/10-mobile-sheet`);

await t.settleResponses();
const failures = classifyFailures(t.errors, t.httpFailures, LIVE && completedCreate && completedEvolve);
if (failures.recovered.length) console.log(`INFO  Atlas rejected ${failures.recovered.length} seed upload(s); deterministic re-tinting recovered and both live chains completed`);
check("no unexpected console errors / failed requests", failures.unexpectedErrors.length === 0 && failures.unexpectedHttp.length === 0, [...failures.unexpectedErrors, ...failures.unexpectedHttp.map(r => `${r.method} ${r.path}: ${r.status}`)].slice(0, 3).join(" | "));
} catch (error) {
  await t.shot(`${out}/failure`).catch(() => {});
  console.error("Browser errors:", t.errors);
  throw error;
} finally {
  await t.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${LIVE ? "" : "  (free run; use --live for the full Create/Evolve journey)"}`);
process.exit(failed.length ? 1 : 0);
