/**
 * zip.ts — OWNER: audio agent.
 * Pure, isomorphic: zips the chunk vocabulary for the qrc-audio-v1 engine input.
 */
import { zipSync } from "fflate";

/** Zip chunks -> application/zip bytes (fflate zipSync, stored/no compression). */
export function zipChunks(chunks: { name: string; wav: Uint8Array }[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const c of chunks) files[c.name] = c.wav;
  return zipSync(files, { level: 0 });
}
