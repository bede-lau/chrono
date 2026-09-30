/** Deterministic exports from the editable phase mark. No network or engine calls. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import sharp from "sharp";

const dir = new URL("../public/brand/", import.meta.url);
const master = await readFile(new URL("chrono-mark.svg", dir), "utf8");
const paths = master.match(/<g[\s\S]*<\/g>/)[0];
const svg = (body, width, height = width) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
const render = (source, size) => sharp(Buffer.from(source)).resize(size, size).png().toBuffer();
await mkdir(dir, { recursive: true });
await writeFile(new URL("chrono-mark-dark.svg", dir), master.replace('fill="#fff"', 'fill="#050506"'));
await writeFile(new URL("chrono-mark.png", dir), await render(master, 1024));

// Generous padding keeps the symbol inside the maskable icon's central safe zone.
const icon = svg(`<rect width="512" height="512" rx="104" fill="#050506"/><g transform="translate(51.2 51.2) scale(3.2)">${paths}</g>`, 512);
const maskable = svg(`<rect width="512" height="512" fill="#050506"/><g transform="translate(102.4 102.4) scale(2.4)">${paths}</g>`, 512);
await writeFile(new URL("icon.svg", dir), icon);
await writeFile(new URL("icon-maskable-512.png", dir), await render(maskable, 512));
for (const size of [16, 32, 48, 180, 192, 512]) {
  await writeFile(new URL(`icon-${size}.png`, dir), await render(icon, size));
}
// ICO uses three PNG frames, supported by modern browsers and desktop OSes.
const frames = await Promise.all([16, 32, 48].map(size => render(icon, size)));
const header = Buffer.alloc(6 + frames.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = header.length;
frames.forEach((frame, i) => {
  const entry = 6 + i * 16;
  header[entry] = header[entry + 1] = [16, 32, 48][i];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frame.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
});
await writeFile(new URL("../src/app/favicon.ico", import.meta.url), Buffer.concat([header, ...frames]));
for (const [name, color] of [["chrono-logo", "#fff"], ["chrono-logo-dark", "#050506"]]) {
  const lockup = svg(`<g transform="translate(0 4) scale(.5)">${paths.replace('#fff', color)}</g><text x="78" y="53" fill="${color}" font-family="Arial, sans-serif" font-size="52" font-weight="600" letter-spacing="-2">Chrono</text>`, 270, 72);
  await writeFile(new URL(`${name}.svg`, dir), lockup);
  await sharp(Buffer.from(lockup)).resize(1080, 288).png().toFile(new URL(`${name}.png`, dir).pathname);
}

const specimen = (await sharp(new URL("../deck/assets/organism.png", import.meta.url).pathname)
  .extract({ left: 760, top: 410, width: 1680, height: 1640 }).resize(670, 654).png().toBuffer()).toString("base64");
const card = svg(`
  <defs><linearGradient id="fade"><stop stop-color="#050506"/><stop offset="1" stop-color="#050506" stop-opacity="0"/></linearGradient></defs>
  <rect width="1200" height="630" fill="#050506"/>
  <image href="data:image/png;base64,${specimen}" x="544" y="-12" width="670" height="654"/>
  <rect x="520" width="130" height="630" fill="url(#fade)"/>
  <g transform="translate(64 54) scale(.36)">${paths}</g>
  <text x="124" y="91" fill="#fff" font-family="Arial, sans-serif" font-size="30" font-weight="600" letter-spacing="-1">Chrono</text>
  <text x="68" y="263" fill="#f5f5f5" font-family="Arial, sans-serif" font-size="64" font-weight="600" letter-spacing="-3">A living quantum</text>
  <text x="68" y="333" fill="#f5f5f5" font-family="Arial, sans-serif" font-size="64" font-weight="600" letter-spacing="-3">organism.</text>
  <text x="70" y="393" fill="#99999e" font-family="Arial, sans-serif" font-size="22">Create. Touch. Evolve.</text>
  <path d="M70 508H470" stroke="#ffffff" stroke-opacity=".16"/>
  ${Array.from({ length: 8 }, (_, i) => `<circle cx="${70 + i * 20}" cy="543" r="3" fill="#fff" opacity="${1 - i * .08}"/>`).join("")}
  <text x="70" y="583" fill="#99999e" font-family="Arial, sans-serif" font-size="14" letter-spacing="2">EIGHT ENGINES. ONE LIFE.</text>
`, 1200, 630);
await sharp(Buffer.from(card)).png().toFile(new URL("social-card.png", dir).pathname);
console.log("Exported Chrono vector logos, transparent PNGs, six icon sizes, three-frame favicon and 1200×630 social card.");
