import { DEFAULT_CONTROLS, type Specimen } from "../src/lib/chain/types";
import { deriveMembraneParams } from "../src/lib/chain/membraneParams";

function specimen(entropy: number, seed: number, sigma: number, meanLuma = 0.5, hueSkew = 0.4): Specimen {
  const bytes = Array.from({ length: 32 }, (_, i) => (seed + i * 37) % 256);
  return {
    id: `fixture-${entropy}-${seed}-${sigma}`,
    name: "Membrane params fixture",
    createdAt: "2026-01-01T00:00:00.000Z",
    generation: 0,
    controls: DEFAULT_CONTROLS,
    wounds: [],
    genome: { hex: "00".repeat(32), bytes, source: "qrng" },
    soma: { size: 1, grid: [0], variance: sigma * sigma },
    metrics: { entropy, meanLuma, hueSkew },
    runs: {},
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function main() {
  const styles = new Set<string>();
  const layers = new Set<number>();
  let minAbsorption = Infinity;
  let maxAbsorption = -Infinity;

  for (const entropy of [0, 2.99, 3, 4.99, 5, 6.49, 6.5, 8]) {
    for (let seed = 0; seed < 256; seed++) {
      for (const sigma of [0, 0.12, 0.3, 0.5]) {
        const s = specimen(entropy, seed, sigma, seed / 255, (seed / 127.5) - 1);
        const p = deriveMembraneParams(s, DEFAULT_CONTROLS);
        const again = deriveMembraneParams(s, DEFAULT_CONTROLS);
        assert(JSON.stringify(p) === JSON.stringify(again), "derivation must be deterministic");
        assert(Object.values(p).every((v) => typeof v === "number" ? Number.isFinite(v) : true), "params must be finite");
        assert(p.reflectance >= 0.05 && p.reflectance <= 0.9, "reflectance outside supported bounds");
        assert(p.absorption >= 0.1 && p.absorption <= 0.98, "absorption outside supported bounds");
        assert(p.layers >= 1 && p.layers <= 4, "layers outside 1..4");
        assert(p.incoming_rays >= p.layers && p.incoming_rays <= 4, "incoming rays must be >= layers and <= 4");
        assert(p.interaction >= -2 && p.interaction <= 2, "interaction outside supported bounds");
        assert(p.resolution === 24, "resolution must stay at 24");
        styles.add(p.style);
        layers.add(p.layers);
        minAbsorption = Math.min(minAbsorption, p.absorption);
        maxAbsorption = Math.max(maxAbsorption, p.absorption);
      }
    }
  }

  assert(styles.size === 4, "all four styles must be reachable");
  assert(layers.size === 4, "all four layer counts must be reachable");
  assert(maxAbsorption - minAbsorption > 0.5, "absorption should vary across tissue and genome inputs");
  assert(maxAbsorption < 0.95, "high entropy must not saturate absorption");

  const interactionSpecimen = specimen(5, 128, 0.2, 0.5, 0.8);
  const off = deriveMembraneParams(interactionSpecimen, { ...DEFAULT_CONTROLS, entanglement: 0 });
  const on = deriveMembraneParams(interactionSpecimen, { ...DEFAULT_CONTROLS, entanglement: 1 });
  assert(off.interaction === 0, "zero entanglement must zero interaction");
  assert(Math.abs(on.interaction) > 0.5, "entanglement must affect interaction magnitude");

  console.log(`Membrane parameter derivation verified: ${styles.size} styles, ${layers.size} layer counts, absorption ${minAbsorption.toFixed(3)}–${maxAbsorption.toFixed(3)}.`);
}

main();
