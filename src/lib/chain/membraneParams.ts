import type { Controls, MembraneArtifact, Specimen } from "./types";

type MembraneStyle = MembraneArtifact["params"]["style"];

const STYLES: readonly MembraneStyle[] = ["3-body", "peaked", "frustrated", "constrained"];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function finite(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? (value as number) : fallback;
}

function round(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

/** Derive stable, bounded Entanglement Shader inputs from this specimen's tissue and genome. */
export function deriveMembraneParams(specimen: Specimen, controls: Controls): MembraneArtifact["params"] {
  const metrics = specimen.metrics ?? {};
  const entropy = clamp(finite(metrics.entropy, 4), 0, 8);
  const meanLuma = clamp(finite(metrics.meanLuma, 0.5), 0, 1);
  const hueSkew = clamp(finite(metrics.hueSkew, 0), -1, 1);
  const sigma = Math.sqrt(Math.max(0, finite(specimen.soma?.variance, 0)));
  const genome = specimen.genome?.bytes ?? [];
  const byte = (index: number) => Math.trunc(clamp(finite(genome[index], 0), 0, 255));

  const layerGene = byte(1) / 255;
  const layers = 1 + Math.round(3 * clamp(0.65 * clamp(2 * sigma, 0, 1) + 0.35 * layerGene, 0, 1));
  const incoming_rays = layers + (byte(5) % (5 - layers));

  // Entropy keeps its original four buckets; a genome offset gives each bucket all four styles.
  const entropyBucket = entropy < 3 ? 0 : entropy < 5 ? 1 : entropy < 6.5 ? 2 : 3;
  const style = STYLES[(entropyBucket + (byte(0) % STYLES.length)) % STYLES.length];

  // Keep high-entropy tissues below saturation while retaining useful variation across genomes.
  const absorptionGene = byte(3) / 255;
  const absorption = 0.1 + 0.56 * Math.pow(entropy / 8, 0.8) + 0.26 * absorptionGene;
  const interactionGene = (byte(2) / 255) * 2 - 1;
  const entanglement = clamp(finite(controls.entanglement, 0.45), 0, 1);
  const interactionSignal = 0.7 * hueSkew + 0.3 * interactionGene;
  const interaction = Math.sign(interactionSignal || interactionGene || 1) * entanglement * (1.6 + 2.4 * Math.abs(interactionSignal));

  return {
    reflectance: round(clamp(0.08 + 0.72 * meanLuma + 0.3 * (byte(4) / 255 - 0.5), 0.05, 0.9)),
    absorption: round(clamp(absorption, 0.1, 0.98)),
    layers,
    incoming_rays,
    interaction: round(clamp(interaction, -2, 2)),
    style,
    resolution: 24,
  };
}
