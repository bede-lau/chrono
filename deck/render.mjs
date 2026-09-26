// Helper used by export.sh: renders deck/chrono-deck.html with Playwright's
// bundled Chromium. Two modes:
//   node render.mjs pdf <htmlPath> <pdfOutPath>
//   node render.mjs previews <htmlPath> <previewDirOutPath>
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import path from "node:path";

const [, , mode, htmlPath, outPath] = process.argv;

if (!mode || !htmlPath || !outPath) {
  console.error("Usage: node render.mjs <pdf|previews> <htmlPath> <outPath>");
  process.exit(1);
}

const url = pathToFileURL(path.resolve(htmlPath)).href;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(url, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
// small settle time for CSS transforms / shadows to paint
await page.waitForTimeout(300);

if (mode === "pdf") {
  await page.pdf({
    path: outPath,
    width: "1920px",
    height: "1080px",
    printBackground: true,
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
    preferCSSPageSize: true,
  });
  console.log(`Wrote PDF via Playwright: ${outPath}`);
} else if (mode === "previews") {
  const slides = await page.locator(".slide").all();
  for (let i = 0; i < slides.length; i++) {
    const file = path.join(outPath, `slide-${i + 1}.png`);
    await slides[i].screenshot({ path: file });
    console.log(`Wrote preview: ${file}`);
  }
} else {
  console.error(`Unknown mode: ${mode}`);
  process.exit(1);
}

await browser.close();
