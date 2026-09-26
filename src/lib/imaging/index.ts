/**
 * Imaging utilities — pure, isomorphic (Node + browser). OWNER: imaging agent.
 * Signatures are a contract for the pipeline agent. Implementations live in
 * sibling files and are re-exported here.
 */
export interface RGBAImage { width: number; height: number; data: Uint8ClampedArray } // RGBA8

/** Encode RGBA -> PNG bytes (use fast-png). */
export { encodePng, decodePng, pngDataUrl } from "./png";

/**
 * Render the colony seed image (Tessa input) from the graph-v1 Bloch vectors.
 * Equirectangular (u = longitude, v = latitude) so it wraps a sphere-like mesh
 * seamlessly in u. Each Bloch vector = one nucleus: its direction places the
 * nucleus on the sphere; its colour uses the SAME colour-sphere mapping Tessa
 * uses (theta=0 white pole, theta=pi black pole, hue = phi azimuth, saturation
 * ~ |r|). Cells = spherical Voronoi around nuclei; membranes between cells
 * darkened; ZZ correlation between two nuclei softens/strengthens their shared
 * membrane. `genome` bytes add deterministic jitter/extra satellite nuclei.
 * Default size 32x32 (Tessa hard cap is 64x64; 32 is far faster on the queue).
 */
export { renderColonySeed } from "./colony";

/** Wound mask for blur-v1 (same WxH as the image it masks). White = full decoherence. Soft radial falloff, u wraps. Base level `baseline` (0..1) everywhere so the whole organism ages a little. */
export { renderWoundMask } from "./mask";

/** Downsample luminance to an N x N grid, normalised 0..1 (for blur-core-v1 `values`). */
export { lumaGrid, imageMetrics } from "./analysis";

/** Parse Radiance .hdr (RGBE, RLE) -> Lut (R channel). Row 0 of the file must map to Lut row 0 (theta = 0). */
export { parseHdrLut } from "./hdr";

/** Unzip the entanglement-shader-v1 ZIP -> LUTs + GLSL source. (use fflate unzipSync) */
export { readShaderZip } from "./shaderZip";
