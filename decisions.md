# Chrono — Architecture Decision Records (ADRs)

## D1: 8-Engine Chain Instead of 4

**Context**: Challenge 06 judges on "number and effective use." PRD.original assumed 4 engines; API spike (§3, BRIEF) confirms all 8 Moth engines exist and support on-platform chaining.

**Decision**: Use comet-qrng → graph → tessa → blur → blur-core → entanglement-shader → qrc-audio → retrocausal-echo (strict daisy chain).

**Consequence**: Increased scope; each stage's latency compounds (worst case: comet 8s + graph 8s + tessa 15min + blur 7s + blur-core 4s + entanglement 60s + qrc-audio 5s + echo 2s ≈ 15+ min/specimen). Mitigated by pre-grown archive + retries with backoff.

---

## D2: Server-Side Proxy for Moth API (CORS, Key Safety)

**Context**: API spike shows CORS only allows `http://localhost:3000`. API key must not be client-side (git secrets scanning).

**Decision**: All Moth calls routed through Next.js `/api/moth/*` handlers. Key lives in `.env.local` (never imported into client code). Proxy implements retry logic + backoff.

**Consequence**: Added `/api/moth/upload`, `/api/moth/submit`, `/api/moth/status`, `/api/moth/result` routes. Browser fetch overhead negligible. Key never leaks to source control.

---

## D3: Chain by output_asset_id (No Re-upload)

**Context**: Each engine outputs an asset; passing `output_asset_id` directly to next engine's `input_files` slot is "true on-platform chaining."

**Decision**: Stages 1→7 accept previous stage's `output_asset_id` directly. No re-download/re-upload of intermediate artifacts (except wounds mask for decoherence).

**Consequence**: Faster handover, fewer API calls, reduced bandwidth. Avoids file corruption in re-encode cycles.

---

## D4: 32×32 Tessa Seed on `aer` Default; `fake_fez` Option

**Context**: Tessa 64×64 `fake_fez` took 13.8 min (unpredictable). `aer` failed at 63 s (retryable). 32×32 targets <2 min on `aer`.

**Decision**: Morphogenesis stage defaults to `machine: "aer"`, `resolution: 32×32`. UI segmented control offers `fake_fez` as science mode (expect 10–15 min + higher retry budget).

**Consequence**: Trade graphics fidelity for hackathon responsiveness. Judge notes show effective use of scaling parameters. Pre-grown archive for timeout resilience.

---

## D5: Retries with Backoff; 25-Min Tessa Budget

**Context**: Tessa latencies unpredictable; `engine_timeout` is retryable. Retry budget = attempt count, not time.

**Decision**: On retryable errors (e.g., `engine_timeout`), retry with backoff (5, 10, 20, 40, 60 s; ≤6 attempts). Tessa polled up to 25 min. Status UI shows "Retrying n/6".

**Consequence**: Graceful failure recovery. User sees retries in telemetry + chain rail. If Tessa times out after 6 retries, organism goes dormant; UI offers manual Retry or load archive.

---

## D6: Pre-Grown Specimen Archive in `public/specimens` (historical; superseded for first-run behavior)

**Context**: Tessa latency + hackathon load risk timeout on cold start. Judges need something to see instantly.

**Decision (Round 1)**: Pre-compute 3–5 complete specimens (genome → echo) and store as JSON snapshots in `public/specimens`. The initial version opened the newest specimen on load. Round 2 supersedes that automatic opening: the app starts blank, loads only the archive list, and opens a specimen only after an explicit selection.

**Consequence (Round 1)**: The archive provided ready-to-load specimens and resilience against Tessa outages. Round 2 retains that fallback, but the user now chooses when to open one; archive availability alone does not guarantee that a deployment is configured or working.

---

## D7: Isomorphic Chain Code (Browser + Node)

**Context**: Pipeline logic (coupling derivations, state transitions) used both in browser UI (`useChrono` controller) and Node CLI (`scripts/grow.ts`).

**Decision**: Chain logic lives in `src/lib/chain/*.ts` (imports exported from Next.js app context; use conditional exports if needed). `scripts/grow.ts` imports and uses same chain controller, types, store contracts.

**Consequence**: Single source of truth for derivations. No divergence between grow script and UI. Reduced bug surface.

---

## D8: Geometry via Blur-Core Displacement + Antipodal Coupling in Vertex Shader

**Context**: Entanglement Shader outputs LUTs (not geometry). Soma depth warping needed for "iridescent membrane" effect.

**Decision**: Blur Core stage outputs nested array (displacement grid). Entanglement Shader params (tissue entropy, soma variance) feed into custom vertex shader that applies sign-flipped offset to antipodal vertex pairs (simulating entanglement non-locality).

**Consequence**: Displacement baked into mesh vertex buffer. Membrane iridescence driven by membrane shader (LUT reflectance/absorption). Two-layer rendering: base mesh + postprocessing for bloom/fresnel.

---

## D9: Audio Vocabulary Synthesized from LUT Rows

**Context**: Audio engine needs to sonify the organism state. Tessa/Blur/Entanglement produce images + LUTs; these encode all organism information.

**Decision**: QRC Audio engine accepts a "vocabulary" derived from Entanglement Shader LUT rows (R/T at each incident angle → pitch/timbre mapping). Voice stage seeds with `genome[8..11]`, variation from entanglement strength.

**Consequence**: Sound is a direct function of organism state. No separate audio model. Echo (retrocausal) applies quantum multi-tap delay, dependent on circuitDepth + entropy.

---

## D10: API Key in `.env.local`, Not Committed; `.env.example` Provided

**Context**: MOTH_API_KEY must not be in git history. GitHub secret scanning enabled.

**Decision**: `.env.local` in .gitignore. `.env.example` shows template (key placeholder). CI/CD sets `MOTH_API_KEY` from GitHub secrets; local dev requires manual `.env.local` setup.

**Consequence**: Safe default. No accidental key leaks. Developers must set key once locally (`cp .env.example .env.local; nano .env.local`).

---

## D11: Next.js 16 Instead of 15

**Context**: `create-next-app` latest is 16.3. BRIEF warns of breaking changes (route `params` is a Promise, ESM-only, streaming aware).

**Decision**: Use Next.js 16.3.6. Read `node_modules/next/dist/docs/` for route handler conventions before any route implementation.

**Consequence**: Latest features (e.g., Partial Prerendering, improved server actions). Learning curve on breaking changes, but aligned with real ecosystem. Agents warned in BRIEF §6.

---

## D12: Zustand Single Store with Fixed Contracts for Parallel Agents

**Context**: Multiple agents editing code in parallel. Store is the single source of truth for organism state.

**Decision**: `src/lib/store.ts` defines `useChrono` store with fixed interface (orchestrator-owned). Agents only add optional fields. Never break existing contract. TypeScript enforces.

**Consequence**: No merge conflicts on store shape. Agents can work independently. Controller and UI share same state atom.

---

## D13: Multi-Agent Build: Opus for Complex, Sonnet for Medium, Haiku for Docs

**Context**: Hackathon time crunch + parallel work.

**Decision**: **Orchestrator (Opus)** coordinates + owns contracts. **Pipeline agent (Opus)** implements moth proxy + chain logic + lifecycle. **Imaging (Sonnet)** handles texture→PNG conversions. **Audio (Sonnet)** handles waveform analysis + playback. **Viewport (Opus)** renders 3D organism + particle effects. **UI (Opus)** shell + controls. **Slides (Sonnet)** deck. **Docs (Haiku)** this file + PRD + README + status.

**Consequence**: Allows parallel sprints. Fixed contracts + BRIEF ensure coherence. Haiku docs agent keeps scope tight (no complex prose). Reduces time-to-demo.

## D14: Hosting via vinext (Next.js on Vite) → Cloudflare Workers, added after the build session

**Context**: Commit `548fc03` ("Update Site source") added a hosting setup outside the agent build: `.openai/hosting.json`, `vite.config.ts`, `scripts/sites-vite-plugin.ts`, and changed `npm run build` to `vinext build`. The standard build is kept as `npm run build:next`; `npm run dev` is still `next dev`.

**Decision**: Keep it. Both builds were re-verified on 2026-09-30. `vite.config.ts` is excluded from the Next type-check because it destructures `d1`/`r2` keys the generated `hosting.json` doesn't declare.

**Consequence**: On Vercel the build command must be overridden to `npm run build:next`. A running Worker was not tested; only that the bundle builds. Runtime secrets `MOTH_API_KEY` / `MOTH_API_BASE` must be set on whichever host serves the app.


## D15: Explicit New Specimen start

**Context**: First-run testing showed that automatically opening the newest archived organism hid the Create action and made the app feel as if work had already started.

**Decision**: Start with no selected specimen, an embryo, idle stages and Parameters active. Load the archive index without opening an entry. Nothing calls the chain until the user presses **Create**. The same primary action becomes **Evolve** for a loaded specimen; New specimen resets to blank while retaining parameter choices.

**Consequence**: The first action and the distinction between creating and evolving are clear; archived specimens remain available by explicit choice.

## D16: Shared Parameters and Evolution panel

**Context**: A separate Inspector made stage details feel detached from the parameter controls and added friction when moving between engines.

**Decision**: Use one right panel with immediate **Parameters | Evolution** switching. Evolution includes concise plain-English engine explanations, visible-organism descriptions, controls, artifact preview and collapsible run details.

**Consequence**: Users can move directly between controls and the selected engine’s explanation while the organism remains the visual focus.

## D17: Chrono Lens for engine attribution

**Context**: The effects of Decoherence, Soma and Membrane were too subtle to attribute to a particular engine.

**Decision**: Each Evolution stage can isolate its contribution on the same organism using a Without/With scrubber, hemisphere comparison and diagnostic overlay. A linked probe connects the organism surface to stage artifact previews.

**Consequence**: Users can see how a stage changes the organism and relate the 2D artifacts to the 3D surface.

## D18: North-up spherical wound mask

**Context**: The first mask rendered UV `v=1` at the north pole while image rows treated `v=0` as the top; flat pixel-space Gaussians also distorted wound shape across the sphere.

**Decision**: Treat `v=1` as the north pole/top row (`row = (1-v)·height`) and form wounds from great-circle distance. Keep a non-zero baseline for Atlas compatibility and make wound contrast visibly stronger.

**Consequence**: Painted wounds align with the organism’s latitude and remain round on its spherical surface.
