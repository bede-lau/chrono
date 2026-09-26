/** entanglement-shader-v1 ZIP unpacking. OWNER: imaging agent. Pure, isomorphic. */
import { unzipSync } from "fflate";
import type { Lut } from "../chain/types";
import { parseHdrLut } from "./hdr";

const utf8Decoder = new TextDecoder("utf-8");

/** Unzip the entanglement-shader-v1 ZIP -> LUTs + GLSL source. */
export function readShaderZip(bytes: Uint8Array): { rLut: Lut; tLut: Lut; glsl: string } {
  const files = unzipSync(bytes);
  const rBytes = files["R_lut.hdr"];
  const tBytes = files["T_lut.hdr"];
  const glslBytes = files["entanglement_texture.glsl"];
  if (!rBytes || !tBytes || !glslBytes) {
    const found = Object.keys(files).join(", ");
    throw new Error(
      `readShaderZip: missing R_lut.hdr, T_lut.hdr or entanglement_texture.glsl (found: ${found})`,
    );
  }
  return {
    rLut: parseHdrLut(rBytes),
    tLut: parseHdrLut(tBytes),
    glsl: utf8Decoder.decode(glslBytes),
  };
}
