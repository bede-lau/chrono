# Chrono — Status & Handover (SOURCE OF TRUTH)

**Last updated:** 2026-09-26 ~17:30 UTC by orchestrator. Session hit its usage limit mid-build; this is the handover snapshot.
Read order for a new agent: this file → `docs/BRIEF.md` (spec, verified API facts, contracts, ownership) → `decisions.md` → `docs/PRD.md` → `AGENTS.md`.

## One-paragraph state
Chrono is a quantum organism for Moth Hack 2026 · Challenge 06 Daisy Chain: 8 Moth Atlas engines chained, each consuming the previous output
(Comet QRNG → Quantum Graph → Tessa → Quantum Blur → Blur Core → Entanglement Shader → QRC Audio → Retrocausal Echo).
**The live chain works end-to-end against the real API**: 3 specimens are grown and saved in `public/specimens/` (`3fd5b1`, `42ac05`, and evolved `42ac05-g1` with 4 wounds).
All modules exist; the remaining work is **integration QA of the full app on :3000, the deck re-export, poster art, final submission text, push, and deploy**.

## How to run
```bash
npm install
# .env.local (not committed):  MOTH_API_KEY=moth_...   MOTH_API_BASE=https://api.mothquantum.com/api/v1
npm run dev                      # http://localhost:3000  (main app)  · /lab/organism · /lab/audio (sandboxes)
npx tsx --env-file=.env.local scripts/grow.ts [--machine aer|fake_fez]          # grow a new specimen (~3–4 min on aer)
npx tsx --env-file=.env.local scripts/grow.ts --evolve 42ac05 --wounds 4        # evolve generation
npx tsx scripts/verify-specimens.ts                                              # validate saved specimens
bash deck/export.sh                                                              # re-render deck/Chrono.pdf
```

## Completion tracker
| # | Area | Owner | Status | Where / notes |
|---|---|---|---|---|
| 0 | Research + API spike | orchestrator | ✅ | `docs/moth/` (openapi.json, hack-event.ts = official challenge text, fixtures/) |
| 1 | Scaffold + contracts | orchestrator | ✅ | Next 16.3, `src/lib/chain/types.ts`, `src/lib/store.ts` (additive-only contracts) |
| 2 | Moth transport + proxy routes | pipeline | ✅ | `src/lib/moth/*`, `src/app/api/moth/*` (assets, engines/[id]/process, jobs/[id]/status+result, assets/[id]/download) |
| 3 | Chain controller + stages | pipeline | ✅ (live-verified) | `src/lib/chain/pipeline.ts`, `controller.ts`, `util.ts`; notes record real derived numbers |
| 4 | Grow script + real specimens | pipeline | ✅ 3 done, 🟡 `308761` was mid-run (partial manifest — delete dir or re-run) | `scripts/grow.ts`, `public/specimens/index.json` |
| 5 | Imaging | imaging | ✅ | `src/lib/imaging/*` (PNG, colony seed, wound mask, metrics, HDR LUT, shader zip) |
| 6 | Audio | audio | ✅ | `src/lib/audio/*`, `src/components/audio/*` (toggle, spectrum, waveform, `useAudioEngine`). Move `src/lib/audio/verify.ts` → `scripts/` |
| 7 | 3D viewport | viewport | 🟡 agent was still iterating on visuals | `src/components/organism/*`, sandbox `/lab/organism`. Verify fps, LUT iridescence, antipodal coupling, click→wound |
| 8 | UI shell | ui | 🟡 agent was still working | `src/components/ui/*`, `src/hooks/*`, `src/app/page.tsx`. **Remove `src/components/ui/_placeholders/`** and point `deps.tsx` at the real Organism/audio/controller |
| 9 | Integration QA on :3000 | next agent | ⬜ | `npx tsc --noEmit`, `npm run build`, open app: archive loads instantly, rail/inspector show job ids + notes, Evolve re-runs 3→7, audio plays, mobile layout |
| 10 | Deck (4 slides, B&W Apple style, daisy SVG diagrams) | slides | 🟡 redo in progress (user asked for more creative SVG diagrams/icons) | `deck/chrono-deck.html`, `deck/export.sh` → `deck/Chrono.pdf`; drop a render into `deck/assets/organism.png` and re-export |
| 11 | Poster art (4:3 render) | next agent | ⬜ | Capture from the app (Capture button / `captureOrganismPng`) → `deck/assets/organism.png` + `docs/poster.png` |
| 12 | Submission answers | orchestrator | 🟡 draft | `docs/submission.md` — rewrite with real facts below (cut self-referential lines) |
| 13 | Push to GitHub `bede-lau/chrono` | next agent | ⬜/🟡 | Local git repo committed. No git credentials here; GitHub connector is `gibbiechu` and can't push binaries → run `git remote add origin https://github.com/bede-lau/chrono.git && git push -u origin main` from a machine logged in as bede-lau (remote has a README-only initial commit: use `git pull --rebase origin main` first or force-push) |
| 14 | Deploy | user/next agent | ⬜ | Needs a server runtime (Atlas CORS only allows localhost:3000 → proxy routes). Vercel: set `MOTH_API_KEY`, `MOTH_API_BASE` |
| 15 | Demo video | user | ⬜ | |

## Live results (real Atlas jobs, all attempt 1)
| Stage | 3fd5b1 (aer) | 42ac05 (aer) | 42ac05-g1 (evolve, 4 wounds) |
|---|---|---|---|
| genesis · comet-qrng | 14.8 s | 11.1 s | cached |
| colony · graph | 5.7 s (10 q) | 5.2 s (8 q) | cached |
| morphogenesis · tessa | 34.1 s | 82.0 s | cached |
| decoherence · blur | 4.5 s | 4.2 s | 6.8 s |
| soma · blur-core | 3.8 s | 4.9 s | 3.7 s |
| membrane · entanglement-shader | 115.3 s | 18.8 s | 164.5 s |
| voice · qrc-audio (fast) | 20.3 s | 17.4 s | 16.5 s |
| echo · retrocausal-echo | 10.5 s | 11.1 s | 10.6 s |
| **total** | **208.9 s** | **154.7 s** | **202.1 s** |
Job ids + coupling notes are in each `public/specimens/<id>/manifest.json` → `runs`.

## Known risks / gotchas
- Tessa is slow/flaky under hackathon load (engine_timeout at ~63 s is retryable; fake_fez once took 14 min, 128×128 took 35 min). Keep 32×32 seeds; Tessa output can be smaller than input (21×21 seen) → mask is sized from the decoded skin.
- Entanglement Shader latency varies 19–165 s.
- Credits/run ≈ comet 5 + graph 5 + tessa 1 + blur 1 + core 1 + shader 1 + qrc 5 + echo 2 = 21; evolve ≈ 10.
- `next dev` with `NEXT_DIST_DIR` rewrites `tsconfig.json` include list — revert those edits before committing.
- Parallel agents may have left uncommitted edits after this snapshot: run `git status` first.
- `/ultrareview` is user-triggered: the user runs `/code-review ultra` themselves.

## Next steps (in order)
1. `git status`; finish #7/#8 wiring (remove UI placeholders), `npx tsc --noEmit`, `npm run build`, QA on :3000 (desktop + mobile).
2. Delete or finish `public/specimens/308761` (partial). Optionally grow 1–2 more (one `fake_fez`).
3. Capture poster → re-export deck → finalise `docs/submission.md` → push → deploy.
