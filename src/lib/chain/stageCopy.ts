/**
 * Plain-English copy for every engine and every mutation parameter.
 * OWNER: orchestrator. Single source of truth — the evolution panel, the parameters panel and the README all read this.
 * Rules: no jargon a first-time visitor wouldn't know; every claim must be something the app actually does.
 */
import type { Controls, StageId } from "./types";

export interface StageCopy {
  /** Under 7 words: the one-line takeaway shown as the panel's subtitle. */
  gist: string;
  /** 1–2 plain sentences: what the engine does. Shown under "What it does". */
  what: string;
  /** 1 sentence: what you can SEE (or hear) on the organism because of this engine. Shown under "On the organism". */
  onBlob: string;
  /** Mutation controls that steer this engine (drives the Parameters <-> Evolution links). */
  controls: (keyof Controls)[];
  /** Labels for the Chrono Lens controls of this engine. */
  lens: {
    /** Name of the "engine off" state, e.g. "Fresh skin". */
    without: string;
    /** Name of the "engine on" state, e.g. "Aged + scarred". */
    with: string;
    /** What the overlay toggle draws on the organism. */
    overlay: string;
  };
}

export const STAGE_COPY: Record<StageId, StageCopy> = {
  genesis: {
    gist: "Quantum dice roll the organism's DNA.",
    what: "Measures 12 quantum bits thousands of times and turns the results into a 32-byte genome. It is real quantum randomness, not a computer's imitation, so no two organisms share DNA.",
    onBlob: "The genome sets the blob's silhouette: its bumps and lobes.",
    controls: [],
    lens: { without: "Smooth seed", with: "Genome-shaped", overlay: "Genome sparks" },
  },
  colony: {
    gist: "Links quantum bits into a cell colony.",
    what: "Uses the genome to connect a few quantum bits into a network. Each bit's measured state becomes a cell nucleus, and how strongly two bits are linked becomes the wall between their cells.",
    onBlob: "Glowing nuclei appear inside the embryo, and the cell layout becomes the body's first faint relief.",
    controls: [],
    lens: { without: "Blank", with: "Cells + nuclei", overlay: "Nuclei + cell walls" },
  },
  morphogenesis: {
    gist: "A quantum round trip paints the skin.",
    what: "Stores every pixel of the colony picture on quantum bits, then reads it back. The round trip leaves its own fingerprint, and the result is the organism's skin.",
    onBlob: "The colour and pattern wrapped around the blob. The IBM Fez noise setting makes it rougher and slower.",
    controls: ["machine"],
    lens: { without: "Colony picture", with: "Quantum skin", overlay: "Pixel grid" },
  },
  decoherence: {
    gist: "Ages the skin; your touches leave scars.",
    what: "Blurs the skin with a quantum blur that smears colour and leaves faint echoes of shapes elsewhere. Where you touched the organism the blur is stronger, so those touches become scars.",
    onBlob: "Touched spots fade and scar. The Decoherence slider sets how far the aging goes.",
    controls: ["decay", "entanglement"],
    lens: { without: "Fresh skin", with: "Aged + scarred", overlay: "Wound heat" },
  },
  soma: {
    gist: "Turns tissue brightness into body shape.",
    what: "Turns the tissue's brightness into a grid of numbers and blurs it the same quantum way. The result is a map of where the body bulges out and where it dents in.",
    onBlob: "The body warps into its final shape, and every bump is mirrored by a dent on the opposite side, like linked twins.",
    controls: ["entanglement"],
    lens: { without: "Smooth sphere", with: "Warped body", overlay: "Bumps, dents + links" },
  },
  membrane: {
    gist: "Thin layers of light give the shimmer.",
    what: "Works out how a stack of ultra-thin layers bounces and splits light, the physics behind soap bubbles and butterfly wings. The tissue's brightness and colour decide how many layers there are and how reflective they are.",
    onBlob: "The oil-slick shimmer: colours shift as you turn the organism.",
    controls: [],
    lens: { without: "Matte tissue", with: "Iridescent", overlay: "Light-angle bands" },
  },
  voice: {
    gist: "A quantum brain composes the song.",
    what: "We synthesize a few one-second drones from the membrane's light tables. This engine, a small quantum reservoir computer, learns their order and composes them into the organism's own song.",
    onBlob: "The organism breathes with its song: the body swells and settles with the sound.",
    controls: [],
    lens: { without: "Still", with: "Breathing", overlay: "Sound ring" },
  },
  echo: {
    gist: "Quantum-timed echoes fill the song.",
    what: "Runs the song through a quantum-timed echo: copies of the sound arrive at moments picked by a quantum measurement, and some are flipped upside-down or played backwards.",
    onBlob: "This is what you hear with the sound on. Circuit depth sets how many echoes there are.",
    controls: ["circuitDepth", "decay"],
    lens: { without: "Dry", with: "Echo ghosts", overlay: "Echo shells" },
  },
};

export interface ParamCopy {
  label: string;
  /** One short sentence, plain English. */
  hint: string;
  /** Engines this control steers (first = primary): a click on the control's link opens that engine's evolution panel. */
  stages: StageId[];
}

export const PARAM_COPY: Record<keyof Controls, ParamCopy> = {
  circuitDepth: { label: "Circuit depth", hint: "How many echoes the quantum delay produces.", stages: ["echo"] },
  entanglement: { label: "Entanglement", hint: "How far the blur reaches, and how strongly each bump is mirrored on the far side.", stages: ["decoherence", "soma"] },
  decay: { label: "Decoherence", hint: "How strongly the skin ages, and how much the echo feeds back.", stages: ["decoherence", "echo"] },
  machine: { label: "Simulator", hint: "Ideal is a perfect simulator. IBM Fez noise copies a real chip's errors: rougher skin, slower.", stages: ["morphogenesis"] },
};

/** Which engines each mutation control steers, reversed: engine -> controls. */
export const controlsFor = (stage: StageId): (keyof Controls)[] => STAGE_COPY[stage].controls;
