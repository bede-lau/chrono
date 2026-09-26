/**
 * Audio — OWNER: audio agent.
 * synth/wav/zip are pure + isomorphic (the pipeline agent calls them in Node for the grow script AND in the browser).
 * player is browser-only.
 */

export { encodeWav, decodeWav } from "./wav";
export type { DecodedWav } from "./wav";
export { synthesizeVocabulary } from "./synth";
export { zipChunks } from "./zip";
