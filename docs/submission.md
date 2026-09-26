# Moth Hack 2026 Submission — Chrono

## 1. Project title

Chrono

---

## 2. Elevator pitch

A living quantum organism grows in your browser as you interact with it, computed across eight Moth Atlas engines in strict sequence where each stage consumes the previous engine's output without training data or scraped material.

---

## 3. Select your challenge

Challenge 06 · Daisy Chain (Intermediate)

---

## 4. Project description

<!-- Word count: 160 -->

Chrono is a browser-based quantum organism that grows through an 8-engine Moth Atlas daisy chain, each stage algorithmically dependent on the previous one's output. The user interacts with a Three.js canvas showing the organism suspended against a black stage—touching it creates decoherence wounds that trigger re-computation of downstream stages.

Every artifact is born from quantum measurement, not training or synthesis: a 32-byte genome from Born-rule measurements seeds a coupling topology, which generates a colony structure, which drives Tessa's quantum skin, which ages under Blur decoherence, which warps through Blur Core displacement, which feeds the Entanglement Shader's iridescent membrane, which generates audio via QRC Audio and Retrocausal Echo. The interface is Apple-grade restraint: hairline UI, the organism as focal point, 60 fps, immediate feedback. An archive persists pre-grown specimens for instant load against Tessa timeouts. Judges inspect each stage via the daisy chain rail inspector, seeing coupling derivations (e.g., "absorption 0.71 ← tissue entropy 5.68 bits") that prove effective engine integration.

---

## 5. Technical description

<!-- Word count: 98 -->

Built on Next.js 16 with React 19, TypeScript, and Tailwind v4. Three.js + React Three Fiber render the organism with custom GLSL implementing the Entanglement Shader's LUT-based iridescence. All eight Moth Atlas engines chain by output_asset_id: Comet QRNG → Quantum Graph → Tessa Image → Quantum Blur → Quantum Blur Core → Entanglement Shader → QRC Audio → Retrocausal Echo. A Next.js API proxy handles CORS (browser to localhost:3000 only). Web Audio plays the echo stage output. zustand manages state; fflate and fast-png handle asset encoding. Genome-derived parameters feed coupling derivations at every stage, visualized in the inspector.

---

## 6. Which Moth Atlas engines did you use?

- Comet Quantum RNG Engine
- Quantum Graph Engine
- Tessa Image
- Quantum Blur
- Quantum Blur Core
- Entanglement Shader
- QRC Audio
- Retrocausal Echo

---

## 7. QPU or emulation?

Emulation. Comet QRNG and Quantum Graph use Aer simulator; Tessa offers IBM Fez noise model via fake_fez option. All eight engines run through the Moth Atlas API with no direct QPU time consumed.

---

## 8. Code repository

https://github.com/bede-lau/chrono

---

## 9. Demo URL

TBD — see orchestrator

---

## 10. Generative AI usage

Yes. Code was written with Claude Code agents (Anthropic); no generative AI was used to create the organism's visuals or sound, which come exclusively from Moth Atlas engines and procedural code.

---

## 11. What generative AI tools did you use?

Claude Code (Claude Opus, Sonnet, and Haiku)

---

## 12. Non-Moth APIs

No. None. All quantum computation goes through the Moth Atlas API; rendering and audio are local browser code.

---

## 13. Non-Moth API details

N/A

---

## 14. Poster art

Upload: poster.png (organism render, 4:3 aspect ratio). Orchestrator will produce from a live specimen snapshot.

---

## 15. Additional images

- Chain rail with inspector panel open, showing coupling derivation note
- Membrane close-up displaying iridescent LUT-driven surface detail
- Wound/decoherence sequence (before touch, wound painted, tissue aged)
- Archive grid of pre-grown specimens (4:3 tiles, identity labels)
- Mobile viewport showing horizontally scrollable chain rail and bottom-sheet controls

---

**Skip:** Demo video field

