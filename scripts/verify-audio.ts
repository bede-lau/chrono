/**
 * verify.ts — OWNER: audio agent. Quick sanity test, not part of the app bundle.
 * Run: npx tsx src/lib/audio/verify.ts
 *
 * Exercises synthesizeVocabulary / encodeWav / decodeWav / zipChunks against a REAL membrane LUT
 * (parsed from the docs/moth/fixtures/shader.zip spike fixture) plus a deterministic fake
 * soma/genome, writes the WAVs to /private/tmp/chrono-audio/, and sanity-checks them (RMS, peak,
 * DC, NaN). The imaging module's parseHdrLut/readShaderZip aren't implemented yet (still
 * `declare` stubs owned by the imaging agent), so this file parses the Radiance RGBE (.hdr) and
 * ZIP itself — throwaway test scaffolding only, not a shared implementation.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import type { GenomeArtifact, MembraneArtifact, SomaArtifact } from "../src/lib/chain/types";
import { decodeWav } from "../src/lib/audio/wav";
import { synthesizeVocabulary } from "../src/lib/audio/synth";
import { zipChunks } from "../src/lib/audio/zip";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- minimal Radiance RGBE (.hdr) decoder: new-style RLE scanlines + flat fallback ------------

function decodeHdrRedChannel(bytes: Uint8Array): { width: number; height: number; data: number[] } {
  let pos = 0;
  const readLine = (): string => {
    let s = "";
    while (pos < bytes.length) {
      const c = bytes[pos++];
      if (c === 10) break;
      s += String.fromCharCode(c);
    }
    return s;
  };

  const magic = readLine();
  if (!magic.startsWith("#?")) throw new Error("decodeHdrRedChannel: not a Radiance HDR file");
  let line: string;
  // Header lines (FORMAT=, EXPOSURE=, ...) until the blank line.
  while ((line = readLine()) !== "") {
    if (pos >= bytes.length) throw new Error("decodeHdrRedChannel: unexpected EOF in header");
  }
  const resLine = readLine();
  const m = resLine.match(/-Y\s+(\d+)\s+\+X\s+(\d+)/);
  if (!m) throw new Error(`decodeHdrRedChannel: unsupported resolution line "${resLine}"`);
  const height = parseInt(m[1], 10);
  const width = parseInt(m[2], 10);
  const data = new Array<number>(width * height).fill(0);

  const toFloat = (r: number, g: number, b: number, e: number): number => {
    void g;
    void b;
    if (e === 0) return 0;
    const f = Math.pow(2, e - 136); // ldexp(1, e-(128+8))
    return r * f;
  };

  for (let y = 0; y < height; y++) {
    if (pos + 4 > bytes.length) throw new Error("decodeHdrRedChannel: unexpected EOF in scanline data");
    const b0 = bytes[pos];
    const b1 = bytes[pos + 1];
    const b2 = bytes[pos + 2];
    const b3 = bytes[pos + 3];
    const isNewRle = b0 === 2 && b1 === 2 && ((b2 << 8) | b3) === width && width >= 8 && width < 32768;
    if (isNewRle) {
      pos += 4;
      const channels = [new Uint8Array(width), new Uint8Array(width), new Uint8Array(width), new Uint8Array(width)];
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < width) {
          const count = bytes[pos++];
          if (count > 128) {
            const runLen = count - 128;
            const val = bytes[pos++];
            for (let i = 0; i < runLen; i++) channels[c][x++] = val;
          } else {
            for (let i = 0; i < count; i++) channels[c][x++] = bytes[pos++];
          }
        }
      }
      for (let x = 0; x < width; x++) {
        data[y * width + x] = toFloat(channels[0][x], channels[1][x], channels[2][x], channels[3][x]);
      }
    } else {
      for (let x = 0; x < width; x++) {
        const r = bytes[pos++];
        const g = bytes[pos++];
        const b = bytes[pos++];
        const e = bytes[pos++];
        data[y * width + x] = toFloat(r, g, b, e);
      }
    }
  }

  return { width, height, data };
}

function loadMembraneFromFixture(): MembraneArtifact {
  const zipPath = resolve(__dirname, "../docs/moth/fixtures/shader.zip");
  const zipBytes = new Uint8Array(readFileSync(zipPath));
  const files = unzipSync(zipBytes);
  const rHdr = files["R_lut.hdr"];
  const tHdr = files["T_lut.hdr"];
  if (!rHdr || !tHdr) throw new Error("loadMembraneFromFixture: fixture missing R_lut.hdr/T_lut.hdr");
  const r = decodeHdrRedChannel(rHdr);
  const t = decodeHdrRedChannel(tHdr);
  console.log(`parsed R_lut.hdr ${r.width}x${r.height}, T_lut.hdr ${t.width}x${t.height}`);
  return {
    params: {
      reflectance: 0.42,
      absorption: 0.5,
      layers: 2,
      incoming_rays: 7,
      interaction: 0.6,
      style: "peaked",
      resolution: r.width,
    },
    rLut: { width: r.width, height: r.height, data: r.data },
    tLut: { width: t.width, height: t.height, data: t.data },
  };
}

function fakeGenome(): GenomeArtifact {
  const bytes = Array.from({ length: 32 }, (_, i) => (i * 41 + 17) % 256);
  return {
    hex: bytes.map((b) => b.toString(16).padStart(2, "0")).join(""),
    bytes,
    source: "qrng",
  };
}

function fakeSoma(): SomaArtifact {
  const size = 32;
  const grid = new Array<number>(size * size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      // A few sharp bumps on a smooth field, so findSomaClicks has real peaks to find.
      const v =
        0.4 +
        0.3 * Math.sin(r * 0.6) * Math.cos(c * 0.4) +
        (r % 9 === 4 && c % 11 === 5 ? 0.5 : 0) +
        (r % 13 === 2 && c % 7 === 3 ? 0.4 : 0);
      grid[r * size + c] = Math.max(0, Math.min(1, v));
    }
  }
  const mean = grid.reduce((a, b) => a + b, 0) / grid.length;
  const variance = grid.reduce((a, b) => a + (b - mean) * (b - mean), 0) / grid.length;
  return { size, grid, variance };
}

function main() {
  const membrane = loadMembraneFromFixture();
  const genome = fakeGenome();
  const soma = fakeSoma();

  const chunks = synthesizeVocabulary(membrane, soma, genome, { chunks: 10, chunkSeconds: 1, sampleRate: 22050 });

  const outDir = "/private/tmp/chrono-audio";
  mkdirSync(outDir, { recursive: true });

  const targetPeak = Math.pow(10, -3 / 20);
  let allOk = true;

  for (const c of chunks) {
    writeFileSync(join(outDir, c.name), c.wav);
    const { channels, sampleRate } = decodeWav(c.wav);
    const ch = channels[0];
    let peak = 0;
    let sumSq = 0;
    let dcSum = 0;
    let nan = false;
    for (const v of ch) {
      if (!Number.isFinite(v)) nan = true;
      const av = Math.abs(v);
      if (av > peak) peak = av;
      sumSq += v * v;
      dcSum += v;
    }
    const rms = Math.sqrt(sumSq / ch.length);
    const dc = dcSum / ch.length;
    const peakDb = 20 * Math.log10(peak || 1e-9);
    const peakOk = Math.abs(peak - targetPeak) < 0.01;
    const dcOk = Math.abs(dc) < 0.005;
    const pass = !nan && peakOk && dcOk;
    if (!pass) allOk = false;
    console.log(
      `${c.name}: n=${ch.length} sr=${sampleRate} peak=${peak.toFixed(4)} (${peakDb.toFixed(2)} dBFS) ` +
        `rms=${rms.toFixed(4)} dc=${dc.toExponential(2)} nan=${nan} ${pass ? "OK" : "FAIL"}`,
    );
  }

  const zipped = zipChunks(chunks);
  writeFileSync(join(outDir, "vocabulary.zip"), zipped);
  console.log(`wrote ${chunks.length} chunks + vocabulary.zip (${zipped.length} bytes) -> ${outDir}`);

  if (!allOk) {
    console.error("SANITY CHECK FAILED");
    process.exit(1);
  }
  console.log("sanity check passed");
}

main();
