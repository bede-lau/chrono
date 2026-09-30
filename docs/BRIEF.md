# Chrono — Build Brief (read this first)

Orchestrator: main Claude session. You are one of several agents working **in parallel** in the same repo
(`/Users/bedelau/Desktop/Chrono`). Stay inside the files you own. Contracts are fixed — see §6.

## 1. What we are building

**Chrono** is a living quantum organism in the browser, built for **Moth Hack 2026 · Intermediate · Challenge 06
"Daisy Chain"** ("Use as many engines as possible in a single project. Measured on number and effective use").
Judging: quality of execution, depth of quantum + Atlas usage, originality.

Every stage of the organism's life is computed by a **different Moth Atlas engine**, and **each engine consumes the
previous engine's output**. Nothing is trained, nothing is scraped: the organism is born from Born-rule
measurements and lives through quantum circuits. The user orbits it, touches it (each touch is a decoherence
wound), and evolves it; it ages, warps, shimmers and sings in response.

Original PRD: `docs/PRD.original.md`. The refinement below supersedes it where they differ (the real Atlas API
differs from the PRD's assumptions: Tessa is image→image capped at 64×64; the Entanglement Shader generates
BSDF LUTs, not geometry; audio engines take audio files).

**UI/UX quality is the #1 priority.** Apple-grade restraint: black stage, the organism is the only colour,
hairline UI, no clutter, no explanatory filler text, every interaction has immediate feedback, 60 fps.

## 2. The daisy chain (8 engines, strictly coupled)

| # | Stage | Engine id | Consumes (from previous) | Produces (for next) |
|---|---|---|---|---|
| 0 | Genesis | `comet-qrng-v1` | Born-rule measurements (12 qubits × 4096 shots, emu) | 32-byte **genome** |
| 1 | Colony | `graph-v1` | genome → `seed`, `num_qubits` (6–10), coupling ring+chords | Bloch vectors = **cell nuclei**, ZZ = membrane coupling → **32×32 colony seed PNG** |
| 2 | Morphogenesis | `tessa-image-v1` | colony seed PNG (uploaded asset) | **quantum skin** PNG (colour-sphere encode/measure/decode) |
| 3 | Decoherence | `blur-v1` | skin **output_asset_id** (no re-upload) + wound **mask** PNG | **aged tissue** PNG |
| 4 | Soma | `blur-core-v1` | 32×32 luminance grid of tissue | non-local **displacement field** (vertex warping) |
| 5 | Membrane | `entanglement-shader-v1` | params derived from tissue entropy/luma/hue + soma variance | ZIP → **R/T LUTs** (+GLSL) → iridescent membrane |
| 6 | Voice | `qrc-audio-v1` | chunk vocabulary synthesized from the LUT rows + soma peaks (zip) | reservoir-sequenced **song** WAV |
| 7 | Echo | `retrocausal-echo-v1` | song **output_asset_id** | quantum multi-tap **echo** WAV (what plays) |

Coupling derivations (pipeline agent implements; every run stores a one-line `note` with the actual numbers,
e.g. `"absorption 0.71 ← tissue entropy 5.68 bits"` — Evolution run details show it; this is how judges see "effective use"):
- Colony: `seed = uint32(genome[0..3])`, `num_qubits = 6 + (genome[4] % 5)` (6–10), `shots 1024`, `mode "emu"`,
  `coupling_map` = ring + chords where genome bits are set.
- Morphogenesis: `machine = controls.machine` (default `aer`; `fake_fez` = IBM Fez noise model), `shots 1024`.
- Decoherence: `strength = 0.25 + 0.6·decay`, `reach = 0.8·entanglement`, `style = rx` (ry collapses gradients),
  mask = spherical great-circle wound Gaussians painted at UV, with `v = 1` at the north pole/top image row (`row = (1-v)·height`); baseline 0.15 keeps the body aging while wounds remain visibly stronger.
- Soma: `values = lumaGrid(tissue, 32)`, `strength = 0.3 + 0.5·entanglement`, `reach = entanglement`, `style "xy"`.
- Membrane: `reflectance = clamp(0.08 + 0.6·meanLuma, .05, .9)`, `absorption = clamp(entropy/8, .1, .98)`,
  `layers = 1 + round(3·normVariance)` (1–4), `incoming_rays = layers + 4 + genome[5] % 4` (respect 21-qubit budget),
  `interaction = clamp(2·hueSkew, -2, 2)` (sign → distinct pattern), `style` by entropy bucket
  (<3 `3-body`, <5 `peaked`, <6.5 `frustrated`, else `constrained`), `resolution 48`.
- Voice: `length 16`, `quality "fast"` (fallback `"instant"` on timeout), `seed = uint32(genome[8..11])`,
  `variation = 0.6 + entanglement`, `crossfade 120`, `loop true`.
- Echo: `n_sites = colony.numQubits`, `depth = circuitDepth`, `theta_x = 0.3 + 1.2·entropy/8`, `mix 0.55`,
  `feedback = 0.3·decay`, `machine "aer"`, `negative_mode "invert"`.

Evolve (user touched the organism): re-run stages 3→7 re-using 0–2 (status `cached`). Audio stages can be
skipped for fast evolves (`withAudio:false`) — they then stay `cached`.
PRD rule kept: **breaking any link halts the lifecycle** — a failed stage stops downstream stages; the organism
goes "dormant" and the UI offers Retry.

## 3. Verified Moth Atlas API facts (spiked 2026-09-26)

- Base: `https://api.mothquantum.com/api/v1` (note the double `/api`). Auth: `Authorization: Bearer $MOTH_API_KEY`.
  Key lives in `.env.local` (`MOTH_API_KEY`, `MOTH_API_BASE`). Never import it into client code.
- **CORS only allows `http://localhost:3000`** → the browser MUST go through our Next.js proxy (`/api/moth/*`).
- Upload: `POST /assets {filename, content_type, size_bytes}` → `{asset_id, upload:{url,method,headers}}` →
  `PUT upload.url` with exactly `upload.headers` → `POST /assets/{id}/complete`. Images must be png/jpeg.
- Submit: `POST /engines/{engine_id}/process {input_files:{slot: asset_id}, params:{...}}` → `202 {job_id,status:"queued"}`.
- Poll: `GET /jobs/{id}/status` → `status: queued|processing|completed|failed`, `error:{type,message,retryable}`.
- Result: `GET /jobs/{id}/result` → `{outputs:[{slot,content_type,size_bytes,output_asset_id,filename,url}], result}`.
  File engines put the file in `outputs[0]` (slot `result`); JSON engines use `result.output`.
- **An output_asset_id can be passed directly as the next engine's input_files slot** (true on-platform chaining).
  Also `GET /assets/{id}/download` → `{download_url}`.
- Measured latencies today (hackathon load): comet-qrng ~8 s, graph ~8 s, blur ~7 s, blur-core ~4 s,
  entanglement-shader ~60 s, **tessa: 32×32 `fake_fez` took 13.8 min; `aer` failed twice with
  `engine_timeout` (retryable) at ~63 s.** Tessa hard cap: 64×64 pixels (`too_many_values`). Use 32×32.
  → Retry `retryable` failures with backoff (5,10,20,40,60 s; ≤6 attempts); poll up to 25 min for Tessa.
- comet-qrng with 8 qubits × 512 shots extracted **0 bytes** (conservative extractor). Use 12 × 4096. If
  `random.bytes < 32`, genome = SHA-256 of the raw counts JSON (`source:"qrng-counts"`).
- graph-v1 result: `result.output.tomography.bloch["0"] = {X,Y,Z}`, `.relationships["0,1"] = {XX..ZZ}`,
  `dominant_bitstring`, `measurements`.
- blur-core-v1 result: `result.output` = nested array same shape as `values`.
- entanglement-shader-v1 ZIP: `entanglement_texture.{osl,frag,glsl,hlsl,mtlx}`, `R_lut.{exr,hdr}`, `T_lut.{exr,hdr}`.
  HDR = Radiance RGBE, `-Y 32 +X 32` at resolution 32 (so `resolution` = LUT size). GLSL contract: s = phase
  (periodic, REPEAT), t = incident angle (row 0 = θ 0), `D = -2·2π·thickness·cosθ`, `s_c = mod(D/λ_c, 2π)/2π`
  for λ = (650, 530, 470) nm, `t = θ/(π/2)`, thickness default 500 nm.
- Fixtures from the spike: `docs/moth/fixtures/` (shader.zip, tessa32-fake_fez.png, seed*.png, result-*.json).
  Full OpenAPI: `docs/moth/openapi.json`. Challenge text: `docs/moth/hack-event.ts`.

## 4. Stack

Next.js **16.3** (App Router, `src/`), React 19.2, TypeScript, Tailwind v4, three 0.186 + @react-three/fiber 9 +
drei 10 + @react-three/postprocessing 3, zustand 5, motion 13 (`import { motion } from "motion/react"`),
lucide-react, fflate, fast-png, tsx. **Next 16 has breaking changes vs your training data — read
`node_modules/next/dist/docs/` before writing route handlers / layouts** (e.g. route `params` is a Promise).
Do NOT `npm install` new packages without telling the orchestrator in your final report (parallel installs
corrupt the lockfile); if you truly need one, install it and say so.

Dev servers: never use port 3000 (orchestrator's). Use your own dist dir + port, e.g.
`NEXT_DIST_DIR=.next-ui npx next dev -p 3101`. Type-check with `npx tsc --noEmit -p .` (other agents' files may be
mid-edit; only fix errors in files you own).

## 5. UX specification (UI + viewport agents)

### Round 2 interaction model
- A new visitor starts with no specimen, an embryo, idle stages and Parameters selected. Bootstrap loads only the archive index; no specimen opens and no engine runs until **Create** is pressed.
- The primary action is **Create** while no specimen is selected and **Evolve** afterwards. **New specimen** resets to the blank state while retaining parameter values. Opening the archive is an explicit user choice.
- One right-side panel has **Parameters | Evolution** views (bottom sheet on mobile). Stage selection, keyboard shortcuts, stage links and the toggle switch views immediately. Evolution follows the active engine while a run progresses until the user manually selects a stage.
- Evolution presents the stage gist, a plain-English “What it does” explanation, “On the organism” explanation, engine-specific controls, artifact preview, then collapsible run details (coupling note, params, job id, latency and attempts). Before Create it remains useful as documentation; artifacts show “Waiting for Create.”
- The **Chrono Lens** isolates an engine’s contribution on the same organism: scrub Without ↔ With, compare hemispheres, or show a diagnostic overlay. Opening an Evolution stage selects its lens; Parameters turns the lens off. Lens overlays and reveal pulses make Decoherence scars, Soma displacement and Membrane angle bands legible on the blob. A linked probe connects blob hover to artifact previews and back.
- Controls preview on the organism immediately; changed values are marked pending until Evolve. A completed, non-cached stage may briefly reveal its contribution unless the user is dragging.

Design language: near-black stage (`#050506`) with a soft radial vignette; the organism is the only saturated
colour. UI is monochrome: white at 90/60/40/12/6 % alpha, hairline 1px borders `white/8%`, 10–12 px uppercase
labels with 0.14em tracking, Geist Sans for UI, Geist Mono for numbers/ids. Accent = `--specimen-hue` (CSS var set
from the colony's dominant nucleus hue) used only for the active stage glow and the primary button focus ring.
Motion: 200–400 ms ease-out, no bounces; the chain rail pulse travels along links as artifacts hand over.
Keep the interface restrained, but explain each engine in plain English in its Evolution view; descriptions live in `src/lib/chain/stageCopy.ts` alongside concise labels.

Layout (desktop): full-bleed canvas.
- Top-left: wordmark **Chrono**, specimen identity `Specimen 7F3A · Gen 3`, genome strip (256 bits as a hairline barcode).
- Top-right: audio toggle (with live mini spectrum), archive, capture (PNG), info.
- Right: one panel with **Parameters | Evolution** toggle. Parameters contains Circuit depth (1–12), Entanglement (0–1), Decoherence (0–1), and Ideal / IBM Fez noise. Footer action is **Create** for a blank state or **Evolve** for a loaded specimen; New specimen is available when one is loaded.
- Bottom: **the daisy chain rail** — 8 nodes with stage, engine and status (idle · running · retrying · done · cached · failed). Selecting a node opens its Evolution view in the shared right panel.
- Bottom-left: telemetry in mono — fps, qubits, active engine, last latency, entropy Δ; expandable log.
- Show “Touch to decohere” only when a specimen exists. A blank state may show a quiet “New specimen” label; there is no central grow button.
- Growing: organism starts as a translucent embryo and gains each property as its stage lands
  (nuclei → skin → aging → shape → iridescence → breath with sound).
- Keys: Space runs the primary action · N new specimen · M mute · 1–8 opens that stage’s Evolution view · Esc returns to Parameters.
- Mobile (<768 px): rail becomes a horizontally scrollable compact strip; controls in a bottom sheet.
- On load: start blank at New specimen. Load the archive list, but open a specimen only on explicit selection.

## 6. Ownership & contracts

Fixed contracts (orchestrator-owned — add optional fields only, never break): `src/lib/chain/types.ts`,
`src/lib/store.ts` (zustand `useChrono`), signature stubs in `src/lib/moth/transport.ts`,
`src/lib/imaging/index.ts`, `src/lib/audio/index.ts`, `src/lib/chain/controller.ts` (replace `declare` stubs with
real implementations keeping the same signatures).

| Agent | Model | Owns |
|---|---|---|
| pipeline | opus | `src/lib/moth/**`, `src/app/api/moth/**`, `src/lib/chain/**` (except types.ts), `scripts/**`, `public/specimens/**` |
| imaging | sonnet | `src/lib/imaging/**` |
| audio | sonnet | `src/lib/audio/**`, `src/components/audio/**`, `src/app/lab/audio/**` |
| viewport | opus | `src/components/organism/**`, `src/app/lab/organism/**` |
| ui | opus | `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`, `src/components/ui/**`, `src/hooks/**` |
| slides | sonnet | `deck/**` |
| docs | haiku | `README.md`, `docs/PRD.md`, `decisions.md`, `status.md`, the handover section of `AGENTS.md` |

Cross-module usage: UI mounts `<Organism />` from `src/components/organism/Organism.tsx` (default export, no
required props; reads the store) and `<AudioToggle />`, `<Spectrum />`, `<Waveform url />` from
`src/components/audio/*`, plus a `useAudioEngine()` hook from `src/components/audio/useAudioEngine.ts` that plays
`specimen.echo.url` when `audioEnabled`, updates `audioLevel`, and exposes `click(strength)` for wound clicks.
UI calls `growSpecimen`, `evolveSpecimen`, `loadArchive`, `loadSpecimen` from the controller.

When done, report: files created, how you verified, anything unfinished, any package installed.
