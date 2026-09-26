/**
 * wav.ts — OWNER: audio agent.
 * Pure, isomorphic (Node via tsx + browser) 16-bit PCM WAV codec. No Buffer, no DOM.
 */

/** Encode mono/stereo float PCM (-1..1) -> 16-bit PCM WAV bytes. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const numChannels = Math.max(1, channels.length);
  const numFrames = channels[0]?.length ?? 0;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  let offset = 0;

  const writeStr = (s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset++, s.charCodeAt(i));
  };

  writeStr("RIFF");
  view.setUint32(offset, 36 + dataSize, true);
  offset += 4;
  writeStr("WAVE");

  writeStr("fmt ");
  view.setUint32(offset, 16, true);
  offset += 4; // PCM fmt chunk size
  view.setUint16(offset, 1, true);
  offset += 2; // audio format = PCM
  view.setUint16(offset, numChannels, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, byteRate, true);
  offset += 4;
  view.setUint16(offset, blockAlign, true);
  offset += 2;
  view.setUint16(offset, bitsPerSample, true);
  offset += 2;

  writeStr("data");
  view.setUint32(offset, dataSize, true);
  offset += 4;

  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = channels[ch]?.[i] ?? 0;
      const clamped = Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0));
      const intSample = Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Uint8Array(buffer);
}

export interface DecodedWav {
  channels: Float32Array[];
  sampleRate: number;
  bitsPerSample: number;
}

/** Decode 16-bit PCM WAV bytes -> float channels (-1..1). For round-trip tests + Waveform drawing. */
export function decodeWav(bytes: Uint8Array): DecodedWav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const readStr = (offset: number, len: number) => {
    let s = "";
    for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
    return s;
  };

  if (readStr(0, 4) !== "RIFF" || readStr(8, 4) !== "WAVE") {
    throw new Error("decodeWav: not a RIFF/WAVE file");
  }

  let pos = 12;
  let numChannels = 1;
  let sampleRate = 22050;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataSize = 0;

  while (pos + 8 <= bytes.length) {
    const chunkId = readStr(pos, 4);
    const chunkSize = view.getUint32(pos + 4, true);
    const body = pos + 8;
    if (chunkId === "fmt ") {
      numChannels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (chunkId === "data") {
      dataOffset = body;
      dataSize = chunkSize;
    }
    pos = body + chunkSize + (chunkSize % 2); // chunks are word-aligned
  }

  if (dataOffset < 0) throw new Error("decodeWav: missing data chunk");
  if (bitsPerSample !== 16) throw new Error(`decodeWav: unsupported bitsPerSample ${bitsPerSample}`);

  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const numFrames = Math.floor(dataSize / blockAlign);
  const channels: Float32Array[] = Array.from({ length: numChannels }, () => new Float32Array(numFrames));

  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sampleOffset = dataOffset + i * blockAlign + ch * bytesPerSample;
      const intSample = view.getInt16(sampleOffset, true);
      channels[ch][i] = intSample < 0 ? intSample / 0x8000 : intSample / 0x7fff;
    }
  }

  return { channels, sampleRate, bitsPerSample };
}
