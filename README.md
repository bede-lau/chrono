# Chrono — Quantum Organism Browser

A living, evolving quantum organism in the browser, computed across **8 Moth Atlas engines in strict daisy-chain sequence**. Each engine consumes the previous output. The user orbits it, touches it (each touch is a decoherence wound), and evolves it in real time. Built for **Moth Hack 2026 · Intermediate · Challenge 06 "Daisy Chain"**.

---

## The 8-Engine Chain

| # | Stage | Engine | Consumes | Produces |
|---|---|---|---|---|
| 0 | Genesis | `comet-qrng-v1` | Born-rule measurements (12 qubits × 4096 shots) | 32-byte **genome** |
| 1 | Colony | `graph-v1` | Genome → seed + coupling topology | 32×32 **colony seed PNG** |
| 2 | Morphogenesis | `tessa-image-v1` | Colony seed PNG | **quantum skin** PNG |
| 3 | Decoherence | `blur-v1` | Skin + wound mask | **aged tissue** PNG |
| 4 | Soma | `blur-core-v1` | Tissue luminance grid | **displacement field** (vertex warping) |
| 5 | Membrane | `entanglement-shader-v1` | Tissue entropy/params | **R/T LUTs** + iridescent shader |
| 6 | Voice | `qrc-audio-v1` | LUT vocabulary + soma peaks | reservoir-sequenced **song** WAV |
| 7 | Echo | `retrocausal-echo-v1` | Song | quantum multi-tap **echo** WAV |

---

## How It Works

1. **Genesis**: Comet QRNG extracts a 32-byte genome from Born-rule quantum measurements.
2. **Genetic landscape**: Graph engine seeds a quantum circuit (6–10 qubits) with genome bits, measures Bloch vectors (nuclei) and ZZ coupling (membrane blueprint), outputs a colony seed PNG.
3. **Skin grown**: Tessa encodes the seed as a colour sphere, measures the sphere, decodes to a 2D texture (quantum skin).
4. **Aging & wounds**: Blur applies entanglement-driven diffusion; user clicks paint wounds (local decoherence). Tissue accumulates age + wounds.
5. **Spatial warp**: Blur-Core outputs a displacement grid; vertex shader applies sign-flipped offsets to antipodal mesh vertex pairs (simulating non-local entanglement).
6. **Iridescence**: Entanglement Shader generates R/T LUTs from tissue entropy/hue. LUTs drive a custom membrane shader (Fresnel + interference patterns).
7. **Sonification**: QRC Audio vocoder derives a vocabulary from LUT rows (each row → pitch/timbre slot). Seeds with genome bits, modulates by entanglement strength. Result: a song unique to this organism.
8. **Quantum echo**: Retrocausal Echo applies multi-tap quantum delay (n_sites = num qubits, depth from circuit) to the song. What the user hears is this echo.

**Interact**: Click the organism to paint a decoherence wound. Adjust sliders (Circuit Depth, Entanglement, Decoherence). Press **Evolve** to re-run stages 3–7 with the new parameters. Organism visibly reacts; sound changes.

---

## Quickstart

```bash
# Install dependencies
npm install

# Create .env.local with your Moth API key
cp .env.example .env.local
# Edit and add: MOTH_API_KEY=<your-key>

# Start dev server
npm run dev

# Open http://localhost:3000
# Click "New Specimen" or load from archive
```

**Grow a specimen from the command line:**
```bash
npx tsx --env-file=.env.local scripts/grow.ts
```

---

## Project Structure

```
Chrono/
├── src/
│   ├── app/
│   │   ├── page.tsx                # Home page (main layout)
│   │   ├── layout.tsx              # App layout, metadata
│   │   ├── globals.css             # Global styles (Tailwind)
│   │   └── api/moth/               # Proxy routes for Moth API
│   │       ├── upload/
│   │       ├── submit/
│   │       ├── status/
│   │       └── result/
│   ├── lib/
│   │   ├── chain/
│   │   │   ├── types.ts            # Specimen, Pipeline, Engine contracts
│   │   │   └── controller.ts       # Lifecycle orchestration (grow, evolve)
│   │   ├── moth/
│   │   │   └── transport.ts        # API client (asset upload, job submit/poll)
│   │   ├── imaging/
│   │   │   └── index.ts            # Texture decode/encode (PNG, LUT heatmaps)
│   │   ├── audio/
│   │   │   └── index.ts            # Waveform analysis, playback
│   │   └── store.ts                # Zustand store (useChrono)
│   ├── components/
│   │   ├── organism/
│   │   │   ├── Organism.tsx        # Three.js 3D viewport
│   │   │   └── shaders/            # Vertex, fragment, membrane shaders
│   │   ├── audio/
│   │   │   ├── AudioToggle.tsx     # Play/mute button
│   │   │   ├── Spectrum.tsx        # Live spectrum analyzer
│   │   │   └── Waveform.tsx        # Waveform display for voice/echo
│   │   └── ui/
│   │       ├── ChainRail.tsx       # 8-node chain status rail
│   │       ├── Inspector.tsx       # Stage details slide-over
│   │       ├── Controls.tsx        # Sliders + buttons
│   │       ├── Telemetry.tsx       # FPS, qubits, latency, log
│   │       └── ...
│   └── hooks/
│       └── useAudioEngine.ts       # Audio playback controller
├── scripts/
│   └── grow.ts                     # CLI: spawn a new specimen end-to-end
├── public/
│   └── specimens/                  # Pre-grown specimen archives (JSON snapshots)
├── deck/                           # Pitch deck (PDF export)
│   ├── assets/
│   └── previews/
├── docs/
│   ├── BRIEF.md                    # Orchestrator brief (read first)
│   ├── PRD.md                      # PRD v2 (refined, this project's spec)
│   └── moth/
│       ├── openapi.json            # Moth Atlas API schema
│       ├── fixtures/               # Example API responses
│       └── hack-event.ts           # Challenge 06 context
├── decisions.md                    # Architecture decision records (D1–D13)
├── status.md                       # Project status & handover guide
├── AGENTS.md                       # Agent ownership & contracts
├── CLAUDE.md                       # User's global instructions
├── README.md                       # This file
├── package.json                    # Dependencies (Next 16.3, React 19.2, three, zustand)
├── tsconfig.json
├── tailwind.config.ts
└── next.config.ts
```

---

## Tech Stack

- **Framework**: Next.js 16.3 (App Router), React 19.2, TypeScript 5
- **Styling**: Tailwind CSS 4, Geist fonts
- **3D Rendering**: three.js 0.186, @react-three/fiber 9, drei 10, @react-three/postprocessing 3
- **State**: zustand 5
- **Animation**: motion 13
- **Utilities**: fflate (ZIP), fast-png (PNG encode/decode), lucide-react (icons), tsx (CLI)

---

## Moth Atlas Engines

All 8 engines publicly documented at [mothquantum.com](https://www.mothquantum.com):

- **Comet QRNG**: Born-rule quantum random extraction
- **Quantum Graph**: Bloch sphere tomography + circuit topology design
- **Tessa**: Image encoding/decoding via quantum colour sphere
- **Blur**: Quantum-walk diffusion (decoherence simulation)
- **Blur-Core**: Topology-preserving displacement field
- **Entanglement Shader**: BSDF LUT generation (R/T reflectance/transmittance)
- **QRC Audio**: Quantum reservoir computing for audio synthesis
- **Retrocausal Echo**: Multi-tap quantum delay effect

---

## UI/UX

**Design**: Black stage (`#050506`), organism is the only colour. Hairline UI (1px borders, white at variable alpha). Geist Sans for text, Geist Mono for telemetry. No explanatory text; short labels only. **Motion**: 200–400 ms ease-out.

**Desktop layout**:
- **Top-left**: Wordmark, specimen identity, genome barcode.
- **Top-right**: Audio toggle (with spectrum), archive, capture, info.
- **Right**: Sliders (Circuit Depth, Entanglement, Decoherence), machine segmented (Ideal/Fez), Evolve badge (wound count), New Specimen.
- **Bottom**: Daisy chain rail (8 nodes, linked line, status indicators, clickable).
- **Inspector**: Right slide-over (click any node) showing stage details, artifacts, coupling notes, job id, latency, attempts.
- **Bottom-left**: Telemetry (FPS, qubits, active engine, entropy Δ), expandable log.

**Mobile** (<768 px): Chain rail horizontal scroll, inspector bottom sheet, controls in sheet.

**Interaction**:
- **Space**: Evolve (re-run stages 3–7 with current sliders).
- **N**: New specimen (re-run entire chain, 0–7).
- **M**: Mute audio.
- **1–8**: Inspect stage (focus chain node).
- **Click organism**: Paint decoherence wound (raycast hit), triggers evolve.
- **Esc**: Close inspector.

**On load**: Show newest archived specimen instantly. No empty screen.

---

## Evaluation (Challenge 06: Daisy Chain)

| Criterion | Execution |
|---|---|
| **Number of engines** | 8 (all publicly available Moth engines). |
| **Effective use** | Strict mathematical coupling: each output feeds next input via `output_asset_id`. Notes field documents numerical derivations (e.g., "absorption 0.71 ← entropy 5.68 bits"). Inspector displays notes for judge review. |
| **Quality** | 60 FPS viewport, zero audio clipping, immediate feedback on all interactions. Hairline UI. Organism as focal point. |
| **Originality** | Procedural life from Born-rule quantum measurements + quantum circuits. No training, no scraped data. User decoherence wounds evolve organism in real time. |

---

## API & Infrastructure

- **Proxy**: All Moth API calls routed through `/api/moth/*` handlers (CORS only allows `localhost:3000` in browser).
- **Key safety**: `MOTH_API_KEY` in `.env.local` (never client-side; `.env.local` in .gitignore).
- **Retries**: Backoff (5, 10, 20, 40, 60 s; ≤6 attempts) on retryable errors (e.g., `engine_timeout`).
- **Caching**: Stages 0–2 cached across evolves. Stages 3–7 re-run on each evolve (unless `withAudio:false`, then audio stays cached).
- **Archive**: Pre-grown specimens stored in `public/specimens/` (JSON snapshots). Instant load, resilience against Tessa timeout.

---

## Known Latencies (Measured at Hackathon)

- **Comet QRNG**: ~8 s (12 qubits × 4096 shots)
- **Graph**: ~8 s (circuit design + tomography)
- **Tessa** (32×32, `aer`): 30 s – 2 min (sometimes retryable timeout at ~63 s)
- **Tessa** (32×32, `fake_fez`): 10–15 min (science mode, higher accuracy)
- **Blur**: ~7 s (diffusion)
- **Blur-Core**: ~4 s (displacement)
- **Entanglement Shader**: ~60 s (LUT computation)
- **QRC Audio**: ~5 s (synthesis)
- **Retrocausal Echo**: ~2 s (delay effect)

**Total first grow (aer)**: ~30–45 min. **Evolve (stages 3–7 only)**: ~2–5 min. Use pre-grown archive for instant demo.

---

## Development & Deployment

**Local**:
```bash
npm run dev        # http://localhost:3000
npm run build      # Verify build
npm run lint       # Type-check + linting
```

**Deployment**:
- Vercel recommended (Next.js native).
- Set `MOTH_API_KEY` in Vercel env vars.
- Proxy routes require Next.js runtime (serverless functions are supported).

---

## Credits

- **Moth Atlas**: comet-qrng-v1, graph-v1, tessa-image-v1, blur-v1, blur-core-v1, entanglement-shader-v1, qrc-audio-v1, retrocausal-echo-v1.
- **Architecture**: See `docs/BRIEF.md` (orchestrator), `decisions.md` (ADR log), `docs/PRD.md` (refined spec).
- **Implementation**: Parallel agents (pipeline, imaging, audio, viewport, ui, slides, docs).

---

## License

MIT
