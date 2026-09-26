// Verifies the BROWSER transport path end-to-end: pipeline -> createBrowserTransport -> Next proxy (:3104) -> Atlas.
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { createBrowserTransport } from "../../src/lib/moth/browser";
import { growChain } from "../../src/lib/chain/pipeline";
import { DEFAULT_CONTROLS } from "../../src/lib/chain/types";
const OUT = process.argv[2];
const t0 = Date.now();
const s = await growChain(
  {
    transport: createBrowserTransport("http://localhost:3104/api/moth"),
    sink: {
      async write(id, name, bytes) { await mkdir(path.join(OUT, id), { recursive: true }); await writeFile(path.join(OUT, id, name), bytes); return `file://${path.join(OUT, id, name)}`; },
      async read(url) { return new Uint8Array(await readFile(url.replace("file://", ""))); },
    },
    reporter: { pushLog: (l) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${l.level} ${l.stage ?? ""} ${l.msg}`) },
  },
  { ...DEFAULT_CONTROLS, machine: "aer" },
);
await writeFile(path.join(OUT, s.id, "manifest.json"), JSON.stringify(s, null, 2));
console.log("PROXY GROW DONE", s.id, Object.values(s.runs).map((r) => `${r!.id}:${r!.status}:${r!.jobId}`).join(" "));
