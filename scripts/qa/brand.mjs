/** Verify browser-facing metadata and icon exports against the built runtime. No paid API calls. */
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import sharp from "sharp";
import { open } from "./harness.mjs";

const [base = "http://localhost:3103", out = "/private/tmp/chrono-brand"] = process.argv.slice(2);
const origin = "https://chrono.bedelau59.chatgpt.site";
await mkdir(out, { recursive: true });
const t = await open({ url: base, width: 1280, height: 800, dpr: 1, settleMs: 1500 });
try {
  const { page } = t;
  const head = await page.evaluate(() => ({
    title: document.title,
    canonical: document.querySelector('link[rel="canonical"]')?.href,
    links: Array.from(document.querySelectorAll("head link"), e => ({ rel: e.rel, href: e.getAttribute("href") })),
    meta: Object.fromEntries(Array.from(document.querySelectorAll("head meta"), e => [e.name || e.getAttribute("property"), e.content])),
  }));
  assert.equal(head.title, "Chrono — A living quantum organism");
  assert.equal(head.canonical, `${origin}/`);
  assert.match(head.meta.description, /Eight linked Moth Atlas engines/);
  assert.equal(head.meta["og:image"], `${origin}/brand/social-card.png`);
  assert.equal(head.meta["og:image:width"], "1200");
  assert.equal(head.meta["og:image:height"], "630");
  assert.ok(head.meta["og:image:alt"]);
  assert.equal(new URL(head.meta["og:url"]).href, `${origin}/`);
  assert.equal(head.meta["twitter:card"], "summary_large_image");
  assert.equal(head.meta["twitter:image"], `${origin}/brand/social-card.png`);
  assert.ok(head.meta["twitter:image:alt"]);
  assert.equal(head.meta["theme-color"], "#050506");
  for (const [rel, path] of [["icon", "/brand/icon.svg"], ["icon", "/brand/icon-32.png"], ["apple-touch-icon", "/brand/icon-180.png"], ["manifest", "/site.webmanifest"]]) {
    assert.ok(head.links.some(link => link.rel === rel && link.href === path), `${rel} ${path} linked`);
  }
  for (const path of new Set(head.links.filter(link => /icon|manifest/.test(link.rel)).map(link => link.href))) {
    const response = await page.request.get(new URL(path, base).href);
    assert.equal(response.status(), 200, `${path} served`);
  }
  const manifest = await (await page.request.get(`${base}/site.webmanifest`)).json();
  assert.equal(manifest.short_name, "Chrono");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.ok(manifest.icons.some(icon => icon.purpose === "maskable"));
  for (const icon of manifest.icons) {
    const res = await page.request.get(`${base}${icon.src}`);
    assert.equal(res.status(), 200);
    const meta = await sharp(await res.body()).metadata();
    assert.equal(`${meta.width}x${meta.height}`, icon.sizes);
  }
  const social = await sharp(await (await page.request.get(`${base}/brand/social-card.png`)).body()).metadata();
  assert.equal(social.width, 1200);
  assert.equal(social.height, 630);
  const ico = await readFile(new URL("../../src/app/favicon.ico", import.meta.url));
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 3);
  for (let i = 0; i < 3; i++) {
    const entry = 6 + i * 16;
    const offset = ico.readUInt32LE(entry + 12);
    const size = ico.readUInt32LE(entry + 8);
    const meta = await sharp(ico.subarray(offset, offset + size)).metadata();
    assert.equal(meta.width, [16, 32, 48][i]);
    assert.equal(meta.height, meta.width);
  }
  assert.match(await (await page.request.get(`${base}/robots.txt`)).text(), /Disallow: \/api\//);
  assert.match(await (await page.request.get(`${base}/sitemap.xml`)).text(), /https:\/\/chrono\.bedelau59\.chatgpt\.site\//);
  const logo = page.getByRole("heading", { name: "Chrono", exact: true }).locator("img");
  assert.equal(await logo.getAttribute("alt"), "");
  assert.ok(await logo.evaluate(img => img.complete && img.naturalWidth > 0));
  await t.shot(`${out}/desktop`);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.waitForTimeout(500);
  assert.ok(await logo.isVisible());
  const brand = await page.getByRole("heading", { name: "Chrono", exact: true }).boundingBox();
  const nav = await page.getByRole("navigation", { name: "Specimen", exact: true }).boundingBox();
  assert.ok(brand.x + brand.width < nav.x, "mobile logo does not collide with actions");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no mobile horizontal overflow");
  await t.shot(`${out}/mobile`);
  assert.equal(t.api.length, 0);
  assert.deepEqual(t.httpFailures, []);
  assert.deepEqual(t.errors.filter(e => !/AudioContext|GL Driver|THREE\.Clock/.test(e)), []);
  console.log("PASS brand: canonical/social/Apple metadata, served icons/manifest, PNG dimensions, three ICO frames, robots/sitemap, desktop/mobile mark, zero engine calls/errors.");
} finally {
  await t.close();
}
