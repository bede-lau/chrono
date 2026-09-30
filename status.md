# Chrono — Status & Handover (SOURCE OF TRUTH)

**Last updated:** 2026-09-30, final-form rendering fix.
Read order: this file → `docs/BRIEF.md` → `decisions.md` → `docs/PRD.md` → `AGENTS.md`. Round 2 requirements are in `docs/ROUND2.md`; verification details are in `docs/ROUND2-QA.md`.

## ROUND 2: COMPLETE

The paused local work has been reviewed, completed and tested. The existing `round2-wip` snapshot is retained. No npm packages were added.

| Piece | State |
|---|---|
| Wound mask | ✅ 98 regression checks: north-up coordinates, great-circle wounds, seams/poles, skin-sized masks, stronger contrast (0.15 baseline). |
| Start flow | ✅ Blank embryo / New specimen / Create on every visit; archive listing never opens a specimen; New preserves controls and stops old audio. |
| Shared panel | ✅ Immediate Parameters / Evolution switching, stage links, keyboard navigation with focus, follow mode, pending controls and plain-English copy. |
| Chrono Lens | ✅ Without/With, scrub, Compare and overlays; Decoherence, Soma and Membrane visually inspected; bidirectional probe and Soma antipode checked. |
| Viewport integration | ✅ 363 picking regressions; CPU ripple/shiver parity, Echo comparison fix, reveal lifecycle and embryo reset. |
| Archived specimen | ✅ `42ac05-g1` regenerated through all five downstream engines in 65 s with four corrected wounds. All five saved specimens validate. |
| Cleanup | ✅ Unused Inspector and evolution sandbox removed; docs reconciled; source lint and TypeScript clean. |
| Live browser journey | ✅ Create: all eight engines in 146 s. Evolve: five engines in 80 s; three wound mask samples agree with clicks. Three Atlas seed rejections recovered via existing deterministic re-tinting. |
| Production checks | ✅ Next and Cloudflare Worker builds; built Worker browser smoke (blank boot, WebGL, archive, lens, reset, no API calls/errors). |
| Release | Public site: https://chrono.bedelau59.chatgpt.site · GitHub: https://github.com/bede-lau/chrono. Sites deployment status identifies the currently published version. |

The completion pass used Luna for mask/docs and bounded lint/audio work, Sol for UI and independent review, and Astra for viewport/shader work. Independent final review found no blocking regressions. Root owned integration, live API runs and publishing.

## Current behavior

Chrono chains eight Moth Atlas engines: QRNG → Graph → Tessa → Blur → Blur Core → Entanglement Shader → QRC Audio → Retrocausal Echo. Visitors explicitly Create or choose an archived specimen. Touches queue wounds; Evolve runs the five downstream stages. One panel explains inputs, engines, artifact provenance and their effects on the organism. The archive contains five specimens, including the regenerated `42ac05-g1`.

Headless screenshots use software WebGL and do not establish a GPU frame-rate benchmark. Engine latency remains variable. Submission form upload and a narrated competition video are separate from this code release.

## Visual identity and metadata: complete

- ✅ Original monochrome phase C mark, redrawn as editable SVG after built-in image generation concept exploration. White/dark lockups and transparent PNGs are in `public/brand/`; the live header uses the mark beside the Geist wordmark.
- ✅ Replaced the default favicon with 16/32/48px ICO frames; SVG/PNG browser icons, 180px Apple icon, 192/512px app icons and a separate maskable icon.
- ✅ 1200×630 social card featuring a real Chrono specimen. Canonical URL, description, Open Graph, Twitter, image alt text, Apple settings, manifest, theme colour, robots and sitemap configured. Labs explicitly noindex.
- ✅ Next build, Worker build, lint and TypeScript pass. `scripts/qa/brand.mjs` verifies served assets, icon dimensions, ICO frames, social metadata and desktop/360px layout against the built Worker with no engine calls. Lab noindex also verified in server HTML.
- Design rationale, exports and the generation prompt: `docs/BRAND.md`. Rebuild exports with `node scripts/generate-brand.mjs`. No packages added; no Atlas credits spent for branding checks.

## Final-form flicker: fixed

- ✅ Critic reproduced whole-stage disappearance on the public site/Apple GPU and isolated it to Echo shells. UI/canvas lifecycle and specimen data were intact.
- ✅ Clamp Echo's normalized dot to `[0, 1]` before fractional Fresnel powers; GPU rounding could otherwise produce invalid colour/alpha and contaminate compositing/bloom. Replaced two signed Gaussian powers with multiplication as additional shader hardening.
- ✅ Controlled WebKit/Apple GPU A/B: removing only the clamp recreated the black frame (mean centre brightness 0.0586/255); the fixed renderer passed 2,700 sampled frames in 15 states over three final specimens, with all centre pixels lit. Critic separately watched Echo, Membrane Compare and Soma overlays remain stable. Existing 363 surface regressions pass.
- ✅ TypeScript, lint, Next production build and deployment Worker build pass.
- Evidence, test commands and scope: `docs/FLICKER-QA.md`; repeatable temporal test: `scripts/qa/flicker.mjs`. No npm dependencies or Atlas calls added. The Playwright WebKit browser binary was downloaded for hardware-backed regression testing.

## Historical verification

The following entries preserve Round 1 evidence; their auto-load/Inspector descriptions are superseded by Round 2 above.

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
| 12 | Submission answers | submission agent | ✅ | `docs/submission.md` — all 15 fields, measured manifest appendix and the live Demo URL. |
| 13 | Push to GitHub `bede-lau/chrono` | orchestrator | ✅ | Pushed to `origin/main`. API key verified absent from every tracked file and from full history; only `.env.example` (placeholder) is committed. |
| 14 | Deploy | orchestrator | ✅ configured | Existing public Sites deployment at `https://chrono.bedelau59.chatgpt.site`; runtime key/base are configured. Release version is tracked by Sites. |
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

## Remaining competition submission steps

1. Paste `docs/submission.md` into the competition form and upload the existing poster/deck plus the Round 2 screenshots.
2. Record a narrated video if required by the competition. Start blank → Create (or choose Archive for a shorter take) → touch → Evolve → compare Decoherence/Soma/Membrane → enable audio.

## Repeatable Round 2 QA

```bash
npx tsc --noEmit -p .
npm run lint
npx tsx scripts/verify-mask.ts
npx tsx scripts/verify-surface.ts
npx tsx scripts/verify-start-flow.ts
npx tsx scripts/verify-specimens.ts
node scripts/qa/e2e.mjs http://localhost:3000 /private/tmp/chrono-e2e
# Add --live for ~31 credits of real Create + Evolve.
# Built Worker smoke (after starting wrangler dev on :3103):
node scripts/qa/production.mjs http://localhost:3103 /private/tmp/chrono-production
```

## If you are a coding agent taking over
- Contracts (`src/lib/chain/types.ts`, `src/lib/store.ts`) are additive-only.
- Don't run a second dev server on :3000; use `NEXT_DIST_DIR=.next-x npx next dev -p 31xx`.
- `next dev`/`next build` rewrite `tsconfig.json`'s `include`; `git checkout -- tsconfig.json` before committing.
- The Moth key lives only in `.env.local` (gitignored); `.env.example` documents the shape.
- To see the app without a browser extension, drive headless Chromium via `deck/node_modules/playwright`
  (that is how the QA above was done).
