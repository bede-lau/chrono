# Chrono — Status & Handover (SOURCE OF TRUTH)

**Last updated:** 2026-09-30 by orchestrator: deck finished, hosting setup re-verified, docs synced.
Read order for a new agent: this file → `docs/BRIEF.md` (spec, verified API facts, contracts, ownership) → `decisions.md` → `docs/PRD.md` → `AGENTS.md`.

## One-paragraph state
Chrono is a quantum organism for Moth Hack 2026 · Challenge 06 Daisy Chain: 8 Moth Atlas engines chained, each consuming the previous output
(Comet QRNG → Quantum Graph → Tessa → Quantum Blur → Blur Core → Entanglement Shader → QRC Audio → Retrocausal Echo).
**The app is feature-complete and verified end-to-end.** 5 specimens are grown and committed in `public/specimens/`.
Integration QA passed on 2026-09-26: `npm run build` succeeds (API routes server-rendered); the app loads the newest archived specimen instantly;
the chain rail, inspector (with live coupling derivations), archive drawer, telemetry and mobile layout all work; the browser console is free of errors;
and **a live Evolve driven from the browser UI ran the real chain through the `/api/moth/*` proxy — 33 API calls, all 2xx, zero errors, 72 s, specimen advanced Gen 1 → Gen 2.**
Remaining (all need you): the deployed Demo URL for the form (field 9), pasting the form answers + uploading the poster/screenshots/PDF, and the demo video.

## Verified integration QA (2026-09-26)
| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx next build` | succeeds; `/` + `/lab/*` static, `/api/moth/*` dynamic |
| App boot on :3000 | loads newest archived specimen immediately, WebGL organism renders |
| Chain rail | all 8 stages with per-stage status + latency |
| Inspector | engine id, consumes→produces, R/T LUT heatmaps, GLSL, params, and the coupling note (e.g. `absorption 0.91 ← entropy 7.28 bits · layers 2 ← soma σ 0.148`) |
| Archive drawer | lists all 5 specimens, marks the one on screen |
| Wound click → Evolve | real chain through the proxy: blur-v1 → blur-core-v1 → entanglement-shader-v1 → qrc-audio-v1 → retrocausal-echo-v1, 72 s, Gen 1 → Gen 2, organism visibly changed, entropy delta shown |
| Browser console | no errors / no failed requests (only dev-only HMR + expected pre-gesture AudioContext warnings) |
| Mobile 390×844 | compact bar, scrollable rail, Evolve pinned, no horizontal scroll |
QA harness (not committed): Playwright scripts in the session scratchpad drove a headless Chromium against :3000.
Screenshots committed to `docs/screenshots/`; poster to `docs/poster.png` and `deck/assets/organism.png`.

## Re-verified 2026-09-30 (after the hosting setup was added to the repo)
Commit `548fc03 "Update Site source"` was made outside the build session: it adds `.openai/hosting.json`, `vite.config.ts`, `scripts/sites-vite-plugin.ts`,
switches `npm run build` to `vinext build` (Next.js on Vite → Cloudflare Workers bundle) and keeps the old build as `npm run build:next`. Re-checked:
| Check | Result |
|---|---|
| `npm run dev` (Next) | starts; `/` 200, `/specimens/index.json` 200, `POST /api/moth/engines/blur-core-v1/process` 202 with a real Atlas job id |
| App in headless Chromium | WebGL canvas renders, all 8 stages listed, 0 console errors |
| `npm run build` (vinext) | succeeds; all 5 `/api/moth/*` routes emitted |
| `npm run build:next` | succeeds |
| `npx tsc --noEmit` | clean after `npx next typegen` (Next 16 generates the global `LayoutProps` types; a fresh checkout needs it once) |
Not verified by me: a *running* Cloudflare Worker (only that the bundle builds). `tsconfig.json` was cleaned: removed leftover `.next-ui/-pipeline/-viewport` include lines and excluded `vite.config.ts`
(it destructures `d1`/`r2`, which the generated `hosting.json` doesn't declare, so it fails `tsc`).

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
| 4 | Grow script + real specimens | pipeline | ✅ 5 specimens | `scripts/grow.ts` → `public/specimens/`: `3fd5b1`, `42ac05`, `42ac05-g1` (evolved, 4 wounds), `308761` (Tessa on `fake_fez`), `6a5efd`. |
| 5 | Imaging | imaging | ✅ | `src/lib/imaging/*` (PNG, colony seed, wound mask, metrics, HDR LUT, shader zip) |
| 6 | Audio | audio | ✅ | `src/lib/audio/*`, `src/components/audio/*` (toggle, spectrum, waveform, `useAudioEngine`). |
| 7 | 3D viewport | viewport | ✅ | `src/components/organism/*`, sandbox `/lab/organism`. LUT iridescence, antipodal displacement and click→wound verified in-browser. |
| 8 | UI shell | ui | ✅ | `src/components/ui/*`, `src/hooks/*`, `src/app/page.tsx`. Placeholders removed; wired to the real Organism / audio / controller. |
| 9 | Integration QA on :3000 | orchestrator | ✅ | See "Verified integration QA" above. |
| 10 | Deck (4 slides, B&W keynote style, daisy of 8 line-art engine icons) | slides | ✅ | `deck/Chrono.pdf` (4 pages, verified) from `deck/chrono-deck.html`. Re-export with `bash deck/export.sh` (Playwright by default; `USE_DIA=1` opts into headless Dia, which hangs if Dia is already open). The HTML is now hand-edited source; the script that first generated it was not kept. |
| 11 | Poster art (4:3 render) | orchestrator | ✅ | `docs/poster.png` (3200×2400) + `deck/assets/organism.png`; UI shots in `docs/screenshots/`. |
| 12 | Submission answers | submission agent | ✅ | `docs/submission.md` — all 15 fields written from measured manifest data, plus an appendix table of specimen `308761`. Only field 9 (Demo URL) is still `TBD`, pending deploy. |
| 13 | Push to GitHub `bede-lau/chrono` | orchestrator | ✅ | Pushed to `origin/main`. API key verified absent from every tracked file and from full history; only `.env.example` (placeholder) is committed. |
| 14 | Deploy | **user** | ⬜ **only blocking item** | Hosting config now exists in the repo (see re-verification above) but I do not know whether a deploy has run or its URL. Whichever host: set runtime secrets `MOTH_API_KEY` and `MOTH_API_BASE`; the app needs a server runtime (Atlas CORS allows only `http://localhost:3000`, hence the `/api/moth/*` proxy). Put the live URL in `docs/submission.md` field 9. |
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
1. **Get the Demo URL** (only blocker for that form field). Needs a server runtime; a static export cannot work (`/api/moth/*` proxy).
   - If the Sites/Cloudflare hosting from commit `548fc03` was already deployed: open it, confirm a specimen loads and Evolve works, and confirm `MOTH_API_KEY` + `MOTH_API_BASE` are set as secrets there.
   - Or Vercel: in the project settings set **Build Command = `npm run build:next`** (plain `npm run build` now produces a Cloudflare bundle, not `.next`), add the two env vars, then `npx vercel --prod` (needs one interactive `npx vercel login`). Untested by me.
   Then paste the URL into `docs/submission.md` field 9.
2. Paste `docs/submission.md` into the Airtable form; upload `docs/poster.png` (poster art),
   `docs/screenshots/*` (additional images) and `deck/Chrono.pdf` (presentation slides).
3. Record the demo video (the only genuinely manual piece): load app → touch the organism a few times →
   Evolve → watch the rail run the 5 downstream engines → open the inspector on Membrane to show the coupling note →
   enable audio. ~72 s of real chain time makes a good real-time take.

## If you are a coding agent taking over
- Contracts (`src/lib/chain/types.ts`, `src/lib/store.ts`) are additive-only.
- Don't run a second dev server on :3000; use `NEXT_DIST_DIR=.next-x npx next dev -p 31xx`.
- `next dev`/`next build` rewrite `tsconfig.json`'s `include`; `git checkout -- tsconfig.json` before committing.
- The Moth key lives only in `.env.local` (gitignored); `.env.example` documents the shape.
- To see the app without a browser extension, drive headless Chromium via `deck/node_modules/playwright`
  (that is how the QA above was done).
