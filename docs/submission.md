# Moth Hack 2026 Submission — Chrono

## 1. Project title

Chrono

---

## 2. Elevator pitch

Chrono grows a specimen through eight Moth Atlas engines in strict sequence, each consuming the last one's output, and lets you touch it to age it.

---

## 3. Select your challenge

Challenge 06 · Daisy Chain (Intermediate)

---

## 4. Project description

<!-- Word count: 196 -->

Chrono is a browser app that grows a specimen through eight Moth Atlas quantum engines, run in strict sequence, and renders the result as a touchable organism. Touching it paints a decoherence wound that reruns the back half of the chain, aging the specimen further.

Each specimen leaves behind eight artifacts, one per stage: a 256-bit genome measured from Born-rule shot counts, a 32x32 colony seed image (qubit Bloch vectors as cell nuclei), a Tessa quantum skin from a color-sphere encode/measure/decode cycle, a blurred and aged tissue map, a non-local displacement field, a set of iridescence lookup tables with their GLSL shader, a reservoir-sequenced WAV song, and a retrocausal echo WAV that is what actually plays. Five specimens are committed under public/specimens with full manifests, including one evolved generation carrying wound scars and one grown on IBM's Fez noise model instead of the ideal simulator.

Nothing here is trained or scraped. Every pixel, vertex offset and audio sample in a specimen traces back to a recorded quantum measurement. The eight engines are chained, not run side by side: each stage's output_asset_id becomes the next stage's input, so breaking one link halts every stage downstream of it.

---

## 5. Technical description

<!-- Word count: 92 -->

Next.js 16 (App Router), React 19, TypeScript and zustand. Eight engines chain by output_asset_id: comet-qrng-v1, graph-v1, tessa-image-v1, blur-v1, blur-core-v1, entanglement-shader-v1, qrc-audio-v1, retrocausal-echo-v1, each consuming the previous stage's Atlas asset directly, no re-upload. A Next.js API proxy (/api/moth/*) holds the API key server-side, since Atlas CORS allows only http://localhost:3000. React Three Fiber renders the mesh; a GLSL fragment shader implements the Entanglement Shader's own R/T LUT contract (phase on one axis, incidence angle on the other, three wavelengths) for the iridescent membrane. Web Audio plays the echo WAV and drives the live spectrum.

---

## 6. Which Moth Atlas engines did you use?

- Comet Quantum RNG Engine — measures 12-qubit Born-rule shots into the 32-byte genome.
- Quantum Graph Engine — turns the genome into a coupling circuit's colony seed image.
- Tessa Image — encodes the colony seed onto qubits, decodes it as skin.
- Quantum Blur — ages the skin into tissue through a wound decoherence mask.
- Quantum Blur Core — converts tissue luminance into the mesh's displacement field.
- Entanglement Shader — turns tissue entropy and hue into the membrane's R/T LUTs.
- QRC Audio — turns LUT rows and soma peaks into a reservoir-sequenced song.
- Retrocausal Echo — re-processes the song into the multi-tap echo that plays.

---

## 7. QPU or emulation?

Emulation. All eight engines ran through Moth Atlas on the Aer simulator. The Tessa (morphogenesis) stage can also run on `fake_fez`, an IBM Fez noise model; specimen `308761` used it and took 658.1 s (about 11 minutes) for that stage alone, against 34.1–89.7 s for the same stage on Aer across the other three freshly grown specimens. No QPU time was consumed.

---

## 8. Code repository

https://github.com/bede-lau/chrono

---

## 9. Demo URL

`TBD`

Needs a server runtime: the Atlas API's CORS policy allows only `http://localhost:3000` as a browser origin, so the app cannot be hosted as a static, client-only build; the Next.js proxy routes that hold the API key must keep running server-side wherever this is deployed.

---

## 10. Generative AI usage

Yes. The code was written with Claude Code agents; no generative AI produced the organism's images or sound, which come from the Atlas engines and procedural code.

---

## 11. What generative AI tools did you use?

Claude Code (Claude Opus, Sonnet, Haiku).

---

## 12. Non-Moth APIs

No. All quantum computation goes through the Moth Atlas API; rendering and audio are local browser code.

---

## 13. Non-Moth API details

N/A

---

## 14. Poster art

poster.png (organism render, 4:3 aspect ratio).

---

## 15. Additional images

- Chain rail with the inspector open, showing a stage's coupling note and job id.
- Membrane close-up showing LUT-driven iridescence at a grazing camera angle.
- Wound sequence: tissue before touch, the painted wound mask, tissue after re-aging.
- Archive grid of the five committed specimens, generation and hue labels visible.
- Mobile layout: horizontally scrollable chain rail with the bottom-sheet controls open.

---

**Skip:** Demo video field

---

## Appendix — measured chain (for reference, not for the form)

Specimen `308761` is the appendix example because it is the only committed specimen whose Tessa (morphogenesis) stage ran on `fake_fez` (IBM's Fez noise model) instead of the ideal Aer simulator. Its genome extractor also certified only 16 of the 32 bytes it needed, so the genome came from SHA-256 of the raw counts instead of direct extraction (the same fallback `6a5efd` needed; `3fd5b1` and `42ac05` extracted all 32 bytes directly). Atlas rejected this specimen's first colony-seed upload, as it also did for `42ac05` and `6a5efd`; the pipeline re-tinted the seed (hue 120°, saturation ×1.4) and resubmitted it. Recorded metrics: entropy 6.79 bits, mean luma 0.51, hue skew -0.31, displacement variance 0.0249, total chain latency 755.97 s (12 min 36 s), 8/8 stages completed on attempt 1. Source: `public/specimens/308761/manifest.json`.

| # | Stage | Engine id | Latency | Job id | Coupling note |
|---|---|---|---|---|---|
| 0 | Genesis | `comet-qrng-v1` | 26.4 s | `f3bd72d3-d20e-42b4-b153-ca7048d51c32` | genome = SHA-256(raw counts, 2600 unique of 4096 shots × 12q) — extractor certified 16 B (h=0.885 b/bit) |
| 1 | Colony | `graph-v1` | 5.7 s | `84225c29-d919-4137-949b-fbe87ceeab19` | 10 qubits ← genome[4]=0x63 · seed 0x308761db ← genome[0..3] · ring 10 + 19 chords · mean \|r\| 0.33 · ⟨ZZ⟩ -0.06…+0.25 → 32×32 seed |
| 2 | Morphogenesis | `tessa-image-v1` | 658.1 s (10 m 58 s) | `0302565f-c88a-4e55-aab5-0460be4b92e7` | 32×32 seed → colour-sphere encode/measure/decode on fake_fez (IBM noise model), 1024 shots/field → skin 21×21 · seed re-tinted (hue 120°, sat ×1.4) after Atlas rejected the original upload |
| 3 | Decoherence | `blur-v1` | 4.2 s | `66577776-586a-4c88-a3e0-a921d8e99d20` | strength 0.55 ← decay 0.50 · reach 0.36 ← entanglement 0.45 · mask 0 wounds + 0.35 baseline · skin chained as output asset e7fd8fd3 → tissue entropy 6.79 bits, mean luma 0.51 |
| 4 | Soma | `blur-core-v1` | 3.3 s | `dc0cd060-0564-4d1b-84f6-74e71907d361` | values = tissue luma 32×32 (mean 0.54) · strength 0.53, reach 0.45 ← entanglement 0.45 · style xy → log-magnitude field over 6.5 decades, σ 0.158 |
| 5 | Membrane | `entanglement-shader-v1` | 26.1 s | `60e0c4f8-22f9-4c44-9a66-65908b2929fe` | reflectance 0.39 ← mean luma 0.51 · absorption 0.85 ← entropy 6.79 bits · layers 2 ← soma σ 0.158 · rays 8 ← layers+4+genome[5]%4 · interaction -0.63 ← hue skew -0.31 · style constrained → 48×48 R/T LUTs |
| 6 | Voice | `qrc-audio-v1` | 19.8 s | `c2181a63-f4b5-47f1-90bb-bcecb252e1b7` | 10 chunks voiced from LUT rows × soma peaks → reservoir (quality fast) seed 0xde613ed5 ← genome[8..11] · variation 1.05 ← entanglement 0.45 → 16-chunk song 14.2 s |
| 7 | Echo | `retrocausal-echo-v1` | 12.4 s | `9916bfe8-43ed-428f-9063-cd590bb9dd3c` | song chained as output asset ce2ca3b9 · n_sites 10 ← colony qubits · depth 8 ← circuit depth · θx 1.32 ← entropy 6.79 bits · feedback 0.15 ← decay 0.50 → 16.5 s stereo echo |
| — | **Total** | | **755.97 s (12 m 36 s)** | | 8 stages, attempt 1, zero retries |
