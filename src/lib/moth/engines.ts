/** Engines the browser proxy may submit to: the 8 daisy-chain engines + two extras. */
export const CHAIN_ENGINES = [
  "comet-qrng-v1",
  "graph-v1",
  "tessa-image-v1",
  "blur-v1",
  "blur-core-v1",
  "entanglement-shader-v1",
  "qrc-audio-v1",
  "retrocausal-echo-v1",
] as const;

export const PROXY_ENGINE_WHITELIST: ReadonlySet<string> = new Set<string>([...CHAIN_ENGINES, "deep-fryer-v1", "telablur-v1"]);

/** Atlas ids are UUIDs; keep the proxy from being used to reach arbitrary paths. */
export const ID_RE = /^[0-9a-fA-F-]{8,64}$/;

/** Content types the upload proxy accepts (Atlas only takes png/jpeg for images). */
export const UPLOAD_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "application/zip",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "application/json",
]);

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
