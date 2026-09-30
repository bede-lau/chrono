# Chrono — PRD v2 (Refined)

## Executive Summary

**Chrono** is a quantum organism in the browser, built for **Moth Hack 2026 · Intermediate · Challenge 06 "Daisy Chain"** (use as many engines as possible; measured on number and effective use). A living entity computed across **8 Moth Atlas engines in strict sequence**, each consuming the previous engine's output. The user orbits it, touches it (each touch is a decoherence wound), and evolves it; it ages, warps, shimmers, and sings in response. **UI/UX quality is priority #1:** Apple-grade restraint—black stage, the organism is the only colour, hairline UI, 60 fps, immediate feedback.

---

## The 8-Engine Daisy Chain

| # | Stage | Engine ID | Consumes (from previous) | Produces (for next) |
|---|---|---|---|---|
| 0 | Genesis | `comet-qrng-v1` | Born-rule measurements (12 qubits × 4096 shots, emu) | 32-byte **genome** |
| 1 | Colony | `graph-v1` | genome → `seed`, `num_qubits` (6–10), coupling ring+chords | Bloch vectors = **cell nuclei**, ZZ = membrane coupling → **32×32 colony seed PNG** |
| 2 | Morphogenesis | `tessa-image-v1` | colony seed PNG (uploaded asset) | **quantum skin** PNG (colour-sphere encode/measure/decode) |
| 3 | Decoherence | `blur-v1` | skin `output_asset_id` (no re-upload) + wound **mask** PNG | **aged tissue** PNG |
| 4 | Soma | `blur-core-v1` | 32×32 luminance grid of tissue | non-local **displacement field** (vertex warping) |
| 5 | Membrane | `entanglement-shader-v1` | params derived from tissue entropy/luma/hue + soma variance | ZIP → **R/T LUTs** (+GLSL) → iridescent membrane |
| 6 | Voice | `qrc-audio-v1` | chunk vocabulary synthesized from the LUT rows + soma peaks (zip) | reservoir-sequenced **song** WAV |
| 7 | Echo | `retrocausal-echo-v1` | song `output_asset_id` | quantum multi-tap **echo** WAV (what plays) |

---

## Coupling Derivations

**Pipeline agent implements; every run stores a one-line `note` with the actual numbers (e.g., `"absorption 0.71 ← tissue entropy 5.68 bits"`). Evolution run details show it; this is how judges see "effective use":**

- **Colony**: `seed = uint32(genome[0..3])`, `num_qubits = 6 + (genome[4] % 5)` (6–10), `shots 1024`, `mode "emu"`, `coupling_map` = ring + chords where genome bits are set.
- **Morphogenesis**: `machine = controls.machine` (default `aer`; `fake_fez` = IBM Fez noise model), `shots 1024`.
- **Decoherence**: `strength = 0.25 + 0.6·decay`, `reach = 0.8·entanglement`, `style = rx` (ry collapses gradients), mask = spherical great-circle wound Gaussians with north-up UVs (`v=1` is the top image row), plus a 0.15 baseline so the whole body ages.
- **Soma**: `values = lumaGrid(tissue, 32)`, `strength = 0.3 + 0.5·entanglement`, `reach = entanglement`, `style "xy"`.
- **Membrane**: `reflectance = clamp(0.08 + 0.6·meanLuma, .05, .9)`, `absorption = clamp(entropy/8, .1, .98)`, `layers = 1 + round(3·normVariance)` (1–4), `incoming_rays = layers + 4 + genome[5] % 4` (respect 21-qubit budget), `interaction = clamp(2·hueSkew, -2, 2)` (sign → distinct pattern), `style` by entropy bucket (<3 `3-body`, <5 `peaked`, <6.5 `frustrated`, else `constrained`), `resolution 48`.
- **Voice**: `length 16`, `quality "fast"` (fallback `"instant"` on timeout), `seed = uint32(genome[8..11])`, `variation = 0.6 + entanglement`, `crossfade 120`, `loop true`.
- **Echo**: `n_sites = colony.numQubits`, `depth = circuitDepth`, `theta_x = 0.3 + 1.2·entropy/8`, `mix 0.55`, `feedback = 0.3·decay`, `machine "aer"`, `negative_mode "invert"`.

**Evolve (user touched the organism):** re-run stages 3→7 re-using 0–2 (status `cached`). Audio stages can be skipped for fast evolves (`withAudio:false`) — they then stay `cached`. **Breaking any link halts the lifecycle** — a failed stage stops downstream stages; the organism goes "dormant" and the UI offers Retry.

---

## UX Specification

### Round 2 interaction model
- New sessions start with `specimen = null`, an embryo, idle stages and Parameters selected. Bootstrap loads the archive list only; no specimen opens and no chain runs automatically.
- The primary action reads **Create** when blank and **Evolve** when a specimen exists. New specimen resets to blank and keeps slider values. Archive loading is explicit. Space invokes the current primary action; N resets; M toggles audio; 1–8 opens Evolution for that stage; Esc returns to Parameters.
- A single right panel (mobile bottom sheet) switches immediately between **Parameters** and **Evolution**. Evolution follows the running stage until the user manually chooses another. Its order is stage header and gist, plain-English “What it does”, “On the organism” with lens controls, engine-specific controls, smooth artifact preview, and collapsible run details. Before Create, it remains documentation and shows “Waiting for Create” in the artifact area.
- The Chrono Lens reveals each engine’s contribution on the same blob through a Without/With scrubber, hemisphere comparison and diagnostic overlay. Stage selection activates its lens; Parameters resets it. A linked probe connects artifact previews with positions on the organism. Controls preview live on the blob and changed values remain marked pending until Evolve.
- The mask uses spherical great-circle wound Gaussians. Wound coordinates use `v = 1` for the north pole/top image row, so image consumers map to `row = (1-v)·height`. The baseline stays non-zero for Atlas input, with stronger wound contrast.
- Plain-English engine explanations live with stage copy and describe both the engine’s role in the chain and its visible contribution. Decoherence, Soma and Membrane effects must read clearly on the organism.

**Design language:** Near-black stage (`#050506`) with soft radial vignette; organism is the only saturated colour. UI monochrome: white at 90/60/40/12/6 % alpha, hairline 1px borders `white/8%`, 10–12 px uppercase labels (0.14em tracking), Geist Sans for UI, Geist Mono for numbers/ids. Accent = `--specimen-hue` (set from colony's dominant nucleus hue) used only for active stage glow and primary button focus ring. Motion: 200–400 ms ease-out, no bounces; chain rail pulse travels as artifacts hand over. The visual interface stays restrained. The Evolution view includes concise plain-English engine explanations so users can understand each stage.

**Layout (desktop):**
- **Top-left**: Wordmark **Chrono**, specimen identity (`Specimen 7F3A · Gen 3`), genome strip (256 bits as hairline barcode).
- **Top-right**: Audio toggle (with live mini spectrum), archive, capture (PNG), info.
- **Right**: Compact controls card — sliders **Circuit Depth** (1–12), **Entanglement** (0–1), **Decoherence** (0–1); segmented **Ideal / IBM Fez noise** (machine). One Parameters | Evolution panel. Footer action is **Create** when blank, **Evolve** when loaded (pending wound badge only for Evolve); New specimen resets a loaded specimen to blank.
- **Bottom**: **Daisy chain rail** — 8 nodes linked by line: index, stage title, engine name, status (idle · running spinner · retrying n/6 · done ✓ + latency · cached · failed). Selecting a stage opens its Evolution view in the right panel.
- **Evolution view** in the shared panel (bottom sheet on mobile): stage title, engine name + id, gist, plain-English explanation, visible effect on organism and lens controls, engine controls, smooth artifact preview, then collapsible coupling note, params, job id, latency and attempts.
- **Bottom-left**: Telemetry in mono — fps, qubits, active engine, last latency, entropy Δ; expandable log.
- **Touch hint**: Show “Touch to decohere” only when a specimen exists.
- **Growing**: Organism starts translucent embryo, gains each property as stage lands (nuclei → skin → aging → shape → iridescence → breath with sound).
- **Keys**: Space primary action · N new specimen · M mute · 1–8 open Evolution stage · Esc return to Parameters.
- **Mobile** (<768 px): Rail becomes horizontally scrollable compact strip; controls in bottom sheet.
- **On load**: Start at New specimen with no specimen selected; load only the archive list. Nothing runs until Create is pressed.

---

## Functional Requirements

### Viewport & Interaction

- **3D Canvas**: Full-window Three.js/WebGL viewport, organism suspended in dark stage.
- **Decoherence Click**: With a specimen loaded, click the surface → raycast UV → paint a spherical great-circle wound mask (north-up image convention) → Evolve stages 3–7. A click records a wound; the primary action starts the run.
- **Mutation Sliders**: Circuit Depth, Entanglement and Decoherence preview on the organism immediately; new values are pending until Evolve.
- **Audio Monitor**: Toggle playback; live mini spectrum analyzer; waveform display for voice/echo stages.
- **Telemetry**: FPS, active qubits, active engine, last job latency, entropy change; expandable structured log.
- **Evolution view**: Shared right panel view showing plain-English stage explanations, Chrono Lens, artifacts, coupling notes, params, job id, latency and retry count.
- **Archive**: Load pre-grown specimens from `public/specimens/` (instant load, resilience against Tessa timeout).
- **Capture**: Export current organism frame as PNG (timestamp-named, stored locally or downloaded).

### Backend & API

- **Proxy**: All Moth API calls go through Next.js `/api/moth/*` routes (CORS only allows `localhost:3000`). API key in `.env.local` (never client-side).
- **Transport**: Asset upload → `POST /assets`, submit job → `POST /engines/{engine_id}/process`, poll status → `GET /jobs/{id}/status`, fetch result → `GET /jobs/{id}/result`. On-platform chaining: pass `output_asset_id` directly to next engine.
- **Retries**: Retryable failures (e.g., `engine_timeout`) retry with backoff (5, 10, 20, 40, 60 s; ≤6 attempts). Tessa polled up to 25 min.
- **Caching**: Stages 0–2 marked `cached` across evolves; stages 3–7 re-run unless `withAudio:false` (then audio stays `cached`).

### Stack

- **Framework**: Next.js **16.3** (App Router, `src/`), React 19.2, TypeScript.
- **Styling**: Tailwind v4, Geist fonts (via `next/font`).
- **3D**: three 0.186, @react-three/fiber 9, drei 10, @react-three/postprocessing 3.
- **State**: zustand 5 (`useChrono` store, fixed contracts).
- **Motion**: motion 13 (`import { motion } from "motion/react"`).
- **Utilities**: fflate (ZIP), fast-png (PNG encode/decode), lucide-react (icons), tsx (script runner).

**Why Next.js 16 not 15**: Latest `create-next-app` + breaking changes in route params (Promise-based), ESM-only environment, streaming response constraints require runtime awareness.

---

## Evaluation Alignment (Challenge 06)

| Criterion | Target | Execution |
|---|---|---|
| **Number of Engines** | Maximum distinct Moth engines. | 8-engine chain (comet-qrng + graph + tessa + blur + blur-core + entanglement-shader + qrc-audio + retrocausal-echo). |
| **Effective Use** | Legitimate algorithmic interdependence; each output directly feeds the next input. | Strict coupling: every stage consumes previous output via `output_asset_id` or stored artifact; notes document numerical derivations (entropy → LUT absorption, etc.). |
| **Quality of Execution** | Polished, bug-free, responsive, 60 fps, zero audio clipping. | Black stage, organism as focal point, hairline UI, immediate feedback on all interactions, telemetry for judge inspection. |
| **Originality** | Novel conceptual exploration. | Quantum physics-driven procedural life, no trained models, no scraped data; user decoherence wounds as interaction mechanism. |

---

## Changes from PRD v1

| Change | Reason |
|---|---|
| 8 engines instead of 4 | Challenge 06 demands maximum engine count; atlas API verified all 8 exist and chain. |
| Tessa 64×64 cap → 32×32 seed for fast_fez | API latency spike: fake_fez at 64×64 took 13.8 min; 32×32 aims for <2 min; `aer` failed at 63 s (retryable). |
| Entanglement Shader returns BSDF LUTs not geometry | API spec: shader outputs R/T LUTs as ZIP (Radiance HDR); geometry moved to Blur Core (displacement grid). |
| Atlas Audio Engine doesn't exist; use QRC Audio + Retrocausal Echo | QRC-audio-v1 synthesizes from LUT vocabulary; Retrocausal Echo applies quantum multi-tap delay to song. |
| Added Comet QRNG + Quantum Graph genesis stages | From Born-rule measurements → genome seed, then genetic algorithm for coupling ring topology. |
| Archive of pre-grown specimens in `public/specimens` | Hackathon load + Tessa latency; pre-computed specimens provide an explicit fast-load option and fallback if Create fails. |
| Server-side proxy (`/api/moth/*`) required | CORS: browser can only hit `localhost:3000`; key safety enforced. |
| Geometry via blur-core displacement + antipodal coupling in vertex shader | Blur Core outputs nested array (displacements); EntanglementShader params (via vertex shader) apply sign-flipped vertex offset to antipodal pairs. |
| Audio vocabulary synthesized from LUT rows | Sound depends on membrane state (LUT reflectance/absorption rows → pitch/timbre mapping). |
| Isomorphic chain code (same code in browser + Node grow script) | `scripts/grow.ts` and browser controller share `src/lib/chain/*.ts` logic (contracts fixed). |

---

## Credits

- **Moth Atlas**: comet-qrng-v1, graph-v1, tessa-image-v1, blur-v1, blur-core-v1, entanglement-shader-v1, qrc-audio-v1, retrocausal-echo-v1.
- **Design guidance**: BRIEF.md by orchestrator.
- **Implementation**: Parallel agents (pipeline, imaging, audio, viewport, ui, slides, docs).
