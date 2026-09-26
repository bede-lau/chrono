<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

# Chrono — Agent Handover

## Read Order

Before starting work, read in this order:
1. **status.md** — Current state, what's done, what's blocking, how to run locally.
2. **docs/BRIEF.md** — Orchestrator's refined specification (§1–6: what we're building, 8-engine chain, API facts, UX spec, ownership, contracts).
3. **decisions.md** — Architecture decision records (D1–D13: why each major choice).
4. **docs/PRD.md** — PRD v2 (refined to real API facts, coupling derivations, functional requirements, stack, evaluation alignment, changes from v1).
5. **AGENTS.md** — This file (agent roster, ownership rules, contract enforcement).

---

## Agent Roster

| Agent | Model | Owns | Status |
|---|---|---|---|
| **Orchestrator** | opus | Contracts (types.ts, store.ts); coordination; integration; QA; submission. | 🟡 in progress |
| **Pipeline** | opus | `src/lib/moth/**`, `src/app/api/moth/**`, `src/lib/chain/**` (except types.ts), `scripts/grow.ts`, `public/specimens/**` | 🟡 in progress |
| **Imaging** | sonnet | `src/lib/imaging/**` (texture decode/encode, LUT heatmaps, PNG handling) | 🟡 in progress |
| **Audio** | sonnet | `src/lib/audio/**`, `src/components/audio/**`, `src/app/lab/audio/**` (waveform, playback, spectrum) | 🟡 in progress |
| **Viewport** | opus | `src/components/organism/**`, `src/app/lab/organism/**` (Three.js scene, shaders, camera, mesh) | 🟡 in progress |
| **UI** | opus | `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`, `src/components/ui/**`, `src/hooks/**` | 🟡 in progress |
| **Slides** | sonnet | `deck/**` (pitch deck, exported as PDF) | 🟡 in progress |
| **Docs** | haiku | `README.md`, `docs/PRD.md`, `decisions.md`, `status.md`, this handover section | ✅ complete |

---

## Rules (Critical)

1. **Contracts are additive-only**: types.ts, store.ts, transport.ts signatures are locked (orchestrator-owned). Add optional fields, never break existing contracts. TypeScript will enforce.
2. **No parallel dev servers on port 3000**: Orchestrator owns 3000. Use your own NEXT_DIST_DIR + port, e.g., `NEXT_DIST_DIR=.next-ui npx next dev -p 3101`.
3. **API key only server-side**: Never import MOTH_API_KEY into client code. Key lives in `.env.local` (in .gitignore). Proxy routes (`/api/moth/*`) access it.
4. **Update status.md**: When you finish a phase, update status.md (change task status from 🟡 to ✅). Orchestrator reviews before each milestone.
5. **Cross-module usage**: UI mounts `<Organism />` (default export from `src/components/organism/Organism.tsx`) and `<AudioToggle />`, `<Spectrum />`, `<Waveform url />` from `src/components/audio/*`. UI calls `growSpecimen`, `evolveSpecimen`, `loadArchive`, `loadSpecimen` from the controller. Audio imports `useAudioEngine()` hook from `src/components/audio/useAudioEngine.ts`.
6. **No new npm packages without orchestrator sign-off**: Parallel installs corrupt lockfile. If critical, install + report to orchestrator in your final summary.

---

## Where Moth API Docs & Fixtures Live

- **OpenAPI spec**: `docs/moth/openapi.json` (full schema for all 8 engines, request/response shapes, error codes).
- **Spike fixtures**: `docs/moth/fixtures/` (example responses: shader.zip, tessa32 output PNG, seed PNGs, result JSON from each engine).
- **Challenge context**: `docs/moth/hack-event.ts` (Challenge 06 text, judging criteria, credit limits, hack schedule).
- **BRIEF (source of truth)**: `docs/BRIEF.md` (refined specs, spiked API facts, verified latencies, contracts).
- **PRD v2**: `docs/PRD.md` (aligned to real API, coupling derivations, UX spec, stack, changes from v1).

---

## How to Hand Off to Next Agent

When your phase is complete:

1. **Update status.md**: Change your phase status to ✅. Add any notes (e.g., "imaging agents verified PNG encode/decode with lossless round-trip").
2. **Run type-check**: `npx tsc --noEmit -p .` (ignore errors in files you don't own; fix only your files).
3. **Write final report**: List files created/modified, how you verified, anything unfinished, any packages installed.
4. **Note blockers**: If another agent is blocked waiting for your work, flag it in status.md or @orchestrator comment.
5. **Leave repo clean**: Commit your work (if instructed). Leave a clear README in any new directories (e.g., `deck/README.md` for slides).

---

## Key Facts

- **First grow is slow** (Tessa is ~30–45 min on aer, up to 15 min on fake_fez). Evolves are faster (~2–5 min, stages 3–7 only). Pre-grown archive in `public/specimens/` ensures demo resilience.
- **Next.js 16 is NOT your training data**: Breaking changes in route params (Promise-based), ESM-only, streaming aware. Read `node_modules/next/dist/docs/` before writing any route handler.
- **Zustand store is single source of truth**: All organism state lives in `useChrono`. Never duplicate state in component props.
- **Coupling notes are the judge's view of "effective use"**: Inspector displays notes; pipeline agent writes them (e.g., "absorption 0.71 ← entropy 5.68 bits"). Spot-check notes for accuracy.
- **Credit spend**: ~21 credits per specimen (comet 5, graph 5, tessa 1, blur 1, blur-core 1, entanglement 1, qrc-audio 5, echo 2). Evolve ~10 credits. Budget conservatively.
