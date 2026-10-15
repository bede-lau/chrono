# Chrono — Status & Handover (SOURCE OF TRUTH)

**Last updated:** 2026-10-15, approved release validated for GitHub and live publication.
Read order: this file → `docs/BRIEF.md` → `decisions.md` → `docs/PRD.md` → `AGENTS.md`. Round 2 requirements are in `docs/ROUND2.md`; verification details are in `docs/ROUND2-QA.md`.

## Release validation (2026-10-15) — COMPLETE

- ✅ User approved all pending changes for commit, push to `bede-lau/chrono` and deployment to the existing public Chrono Site. Earlier “complete locally” notes below describe their original phase state; this release includes those changes.
- ✅ TypeScript, full lint, diff checks, the vinext production build and all ten offline verifiers pass: mask, surface, interactions, audio interactions, membrane parameters, Morphogenesis, Moth keys, Echo resume, OpenAI images and signed image jobs.
- ✅ Built Cloudflare Worker smoke: blank boot, archive loading, WebGL rendering, custom Interaction menu, Rhythm tap and tempo rerender; no browser errors. Invalid image input and malformed OpenAI receipt status/result routes return the expected safe errors. No paid engine submissions during release verification.
- ✅ Actual credential values are absent from all 253 source files and all 89 browser output files checked. `.env.local` remains ignored. The hosted runtime has the OpenAI key and stable receipt-signing secret configured as secrets; existing Moth settings and public audience are preserved.
- Publication identity: `.openai/hosting.json` → `appgprj_6ab8e5c6387c81919e72a72b465a3a8b`; GitHub and Sites deployment records identify the published commit/version. Local development remains available at **http://localhost:3002/**.

## Interaction card layouts and Rhythm warning (2026-10-15) — COMPLETE LOCALLY

- ✅ Pressure and Tug use 280px cards with full-width 40px hold controls; Rhythm uses a 304px card with aligned tap/feedback columns, Tempo/BPM row and full-width slider. Headers and hints share content edges. Light retains its 340px width; desktop panel clearance follows each card's width.
- ✅ Fixed the React style warning in `SpecimenProbes.tsx`'s rhythm indicator (the reported Waveform stack location was inaccurate). Replaced the inline `animation` shorthand with separate name, duration, timing, iteration and play-state properties.
- ✅ Browser QA at 824×853 and 390×844 checks all three layouts and hold-button keyboard release. First tap starts the beat; changing to 60/140 BPM updates its period and resets it paused as intended, then a fresh tap restarts it. Original 131 BPM restored; zero new console errors and no engine submissions. Specimen 823B and three queued wounds preserved.
- ✅ Independent review of all six captures found no material layout/focus/animation blocker. TypeScript, component lint, diff checks and vinext build pass. Detail screenshots: `docs/screenshots/{pressure,tug,rhythm}-controls.jpg`; full captures: `/private/tmp/chrono-layout-qa/`.

Server remains open at **http://localhost:3002/**. No commit, push or deployment.

## Interaction menu replacement (2026-10-15) — COMPLETE LOCALLY

- ✅ Replaced the rejected native white Interaction selector with a dark upward portal popover. Six icon rows include short action descriptions and a checkmark for the current mode; it flips and scrolls within the viewport. Combobox/listbox semantics support Arrow, Home, End, Enter, Space, and typeahead, with Escape, outside-click, and Tab dismissal. Global shortcuts and outside surface clicks are protected.
- ✅ `SpecimenProbes` uses the new menu while Pulse remains separate; the idle Inspect instruction stays removed. The tray clamps clear of the 344px inspector on narrow desktop (20.6px measured gutter at 878px) and centres at 1218px and 390px. No dependencies or engine behavior changed.
- ✅ Browser QA exercised all six pointer modes, Arrow/Home/End/Enter, `p` typeahead, Tab focus to Pulse, and Escape/outside dismissal. The same 823B specimen and two pending wounds remained; no engine submissions occurred. Captures: `.impeccable/review/{desktop.jpg,user-1218.jpg,mobile.jpg}` and `docs/screenshots/interaction-menu.jpg`.
- ✅ Final TypeScript, component lint, diff checks, and vinext production build pass; browser console has zero errors. The independent UI reviewer scored the narrow-desktop collision and opening-animation findings resolved after all three sizes were recaptured. The Impeccable launcher was unavailable (permission denied), so separate UI review and documentation agents used the incumbent implementation; its detector was unavailable. No PRODUCT.md or DESIGN.md exists; no visual identity or new configuration was created. The selector pattern reference was [CopilotKit's selector-card.tsx](https://github.com/CopilotKit/CopilotKit/blob/main/examples/showcases/reskinnable-demo/src/shell/layout/selector-card.tsx).

Local server remains open at **http://localhost:3002/**. No commit, push or deployment.

## Earlier native select iteration (2026-10-15) — SUPERSEDED

- ✅ Replaced the platform-positioned native indicator with a decorative, pointer-transparent chevron, vertically centred with a 12px trailing inset and reserved text padding. The native labelled select remains.
- ✅ Options now specify both background and text colours: dark text on white, with a pale grey selected option, matching the native light popup shown in the report. Removed the idle Inspect instruction (“Click to read a point · no mark”), including its empty row and description reference; a pinned point can still show its status.
- ✅ Browser checks switched all six modes, verified option/selected computed colours and exact arrow alignment at desktop 1218×853 and phone 390×844. The same C30B specimen and four pending wounds remain; no engines ran. TypeScript, component lint and diff checks pass. Native popup pixels were unavailable through browser capture, so popup colours were checked through computed option styles; opening/keyboard selection was not visually verified.

## OpenAI Morphogenesis (2026-10-14) — COMPLETE LOCALLY

- ✅ User authorized replacing Tessa with OpenAI image editing while preserving the frontend exactly. The existing Morphogenesis process endpoint now edits the real Colony PNG with `gpt-image-2.5-flare`, normalizes its output to the original seed dimensions, and uploads the skin to the same Moth credential scope for downstream engines.
- ✅ OpenAI credentials and a stable receipt-signing secret are configured only in ignored `.env.local`. Completed jobs use signed, credential-scoped receipts so status/result work across server instances without an in-memory job registry. Provider errors are sanitized and never trigger an automatic paid retry.
- ✅ Live browser Create completed all eight stages, including Morphogenesis in **19 s**, on one image attempt. Decoherence, Soma, Membrane, Voice and Echo consumed the result successfully; the final blob rendered with zero browser errors. OpenAI request: `req_f0d4dbb2473d4f1aa183cfe0d60ff9c0`.
- ✅ Image request/PNG tests, completed-job compatibility, receipt tamper/scope/expiry tests, and existing Morphogenesis/Echo recovery regressions pass. Source snapshot confirms all 84 pre-existing non-API source files remain byte-identical for this phase.
- ✅ Full lint, TypeScript, vinext and isolated Next production builds pass; client bundles contain neither OpenAI key nor receipt secret. Next route types were regenerated after vinext's incompatible generated type format, with no source/config workaround.
- Frontend labels, simulator controls and historical Tessa coupling copy intentionally remain unchanged per the user's explicit restriction; they do not describe the new provider. Backend result metadata records OpenAI/model/request ID. Earlier all-Moth requirements are superseded for this stage only.

The local server and finished specimen remain open at **http://localhost:3002/**. No commit, push or deployment. Details and limitations: [`docs/OPENAI-MORPHOGENESIS.md`](docs/OPENAI-MORPHOGENESIS.md).

## Tessa retest (2026-10-14) — REMOTE FAILURE PERSISTS

- ✅ Fresh credential check passed; engine metadata remains enabled with the same advertised 18,000-second run policy and parameter schema.
- ⚠️ Fresh 2×2 palette / `aer` / one-shot request failed after 63.094 s (`b2c5cce3-eaaa-4813-901b-41027a0ef086`).
- ⚠️ New validation diagnostic: a 2×2 palette / `aer` / 64-shot request with `distortion:1` should surface the documented `distortion_without_hardware` error. It instead failed with `engine_timeout` after 63.063 s (`4bfcc589-8a04-4fa2-b863-3bfcba707cb4`). This adds evidence of a Tessa handler/dispatch problem, but does not expose the internal root cause.
- ⚠️ Current app configuration, 16×16 / `aer` / 128 shots, also failed through the local proxy after 63.153 s (`a540dcde-5050-45cf-b972-3a9222932094`). The test input came from archived `6a5efd`'s colony; no browser specimen was changed.
- ✅ Fresh `test-engine-v1` control completed through the direct transport in 8.486 s (`66075a0d-eedc-46f0-94e9-fc9dbf5134d7`). Its metadata confirmed zero advertised credits. The app proxy intentionally rejects that diagnostic engine; a locally rejected control attempt created no Moth job.
- ✅ Added `--only LABEL` and `--direct` to the diagnostic script so retests can make exactly one submission. The original default matrix remains unchanged. TypeScript, diagnostic lint, offline CLI checks and independent review pass.

Three Tessa submissions, one completed free control, no automatic retries or downstream engines. Raw terminal statuses and exact requests are saved in [`docs/moth/tessa-retest-2026-10-14.json`](docs/moth/tessa-retest-2026-10-14.json). No working configuration or app repair was established; the next useful evidence requires Moth's worker/dispatch logs. The local server was restarted on **http://localhost:3002/** and remains open. Changes this phase are diagnostic tooling and documentation only; nothing was committed, pushed or deployed.

## Morphogenesis timeout recovery (2026-10-13) — APP FIX VERIFIED; UPSTREAM STILL FAILING

- ✅ Diagnosed the user's `737aa0` run: six identical 32×32/256-shot requests failed with Moth `engine_timeout` at roughly 63 seconds each. Increasing backoffs stretched the stage from 10:04:37 to 10:13:15. This was repeated upstream failure, not a stuck browser timer.
- ✅ Tessa now uses a separate 16×16 input at 128 shots, preserving the original 32×32 Colony artifact. At most one 64-shot fallback follows a confirmed terminal engine timeout. Manual retries after that remain at 64 shots. This supersedes the earlier 256-shot workload policy below.
- ✅ The Tessa local polling window is 90 seconds instead of 40 minutes. Unknown remote state stays resumable; no fallback is submitted for local timeout, network, result, or output uncertainty. Resume keeps the original job, input, parameters and attempt count.
- ✅ **Retry Morphogenesis** continues the partial specimen without repeating Genesis/Colony. Actual input previews, per-stage retry budgets and full Morphogenesis elapsed time are recorded.
- ✅ TypeScript, full lint, diff checks, Morphogenesis regressions and existing Echo recovery regressions pass. Browser QA confirmed the same specimen/genome, 128→64 parameters, attempts 1/2→2/2, and halt after exactly two submissions (10:32:11–10:34:21).
- ⚠️ Live Tessa remains unavailable for these requests: both 16×16 attempts returned upstream `engine_timeout`. One additional bounded 8×8/16-shot diagnostic also failed after 62.8 seconds. This strongly points to an upstream service issue; the current specimen has not completed Morphogenesis. No further jobs were submitted.
- ⚠️ Later follow-up (11:36–11:43 UTC): 16×16 palette mode, a fresh four-pixel palette input, and the same tiny input on `fake_fez` all returned terminal `engine_timeout` after ~63 s. A free control engine completed through the same credentials/transport in 8.3 s. These three further Tessa diagnostics did not produce a usable correction; no unverified palette/backend change was adopted. Operator-ready job IDs and reproduction are in the recovery document.
- ✅ The user explicitly requires all eight engines. No local skin substitute or skipped stage was added. The persistent failure banner and toast now explain the Moth engine timeout; the technical error remains available in Run details.
- ✅ Historical control (11:52–11:54 UTC): extracted the original client/poller from verified commit `4b123ed`, replayed the exact previously successful 32×32 input from `6a5efd` with `aer`/1,024 shots, and repeated through today's local proxy. Both returned terminal `engine_timeout` in 62.802/62.963 s despite the original 40-minute polling window. Exactly two submissions; uploaded bytes verified by SHA-256. The original settings did not restore completion and were not adopted as a repair. See `scripts/qa/morphogenesis-baseline.ts` and the recovery document for reproduction and job IDs.
- ⚠️ Supported-parameter sweep (13:03–13:10 BST): six new single-attempt `aer` variants—8×8 palette/merged at 64 shots, 16×16 palette at 256, 4×4 palette at 16, and four-pixel palette/merged at the minimum one shot—all returned terminal `engine_timeout` in 62.5–64.4 s. No skin or candidate; no app default was changed. Exact requests/job IDs are saved in `docs/moth/tessa-variants-2026-10-13.json`; `scripts/qa/tessa-variants.ts` reproduces the bounded sweep. TypeScript, lint, offline checks and independent review pass. The stopped server was restarted; browser inspection was blocked by the browser URL policy, so this phase has API verification only.

The server is running at **http://localhost:3002/**. The diagnostic scripts do not access or alter the user's partial **Specimen 737A**. Each investigation's diagnostic count is recorded above; no Genesis/Colony reruns or downstream jobs were required. The latest comparison changed only diagnostic tooling and documentation. Changes are local, not committed/pushed/deployed. Details: [`docs/MORPHOGENESIS-RECOVERY.md`](docs/MORPHOGENESIS-RECOVERY.md).

## Interaction experiments (2026-10-13) — COMPLETE

- ✅ Pressure test: hold/drag deformation with Soma-derived spring stiffness and release settling; keyboard demonstration targets the visible centre.
- ✅ Entangled tug: inverse antipodal response controlled by Entanglement, contact rings and a temporary connecting trace.
- ✅ Rhythm play: 60–140 BPM, beat indicator, visible sync streak, surface pulses and bounded synthesized notes. Space within the controls cannot trigger Create/Evolve; global Space taps only in idle Rhythm mode.
- ✅ Light probe: direct dragging plus keyboard-accessible sliders/reset move the shader key light and reflections.
- ✅ Experiments are local and reversible; existing Touch/Inspect/Pulse remain. State clears across mode/specimen/chain changes, pointer cancellation, capture loss, Escape, blur and hidden documents. No new dependencies or Moth engine calls.
- ✅ Audio follow-up: muted specimen selection no longer creates an audio context or fetches/decodes its WAV. Rhythm timestamp resets stay silent; muting stops and disconnects queued notes.
- ✅ QA loop: TypeScript, full lint, interaction/audio regressions, and all 363 existing surface samples pass. Browser checks used archived 42AC G1, including held Pressure, tug drag/release, an In sync keyboard streak, light extremes/direct drag, mute/unmute, and no queued wounds on returning to Touch. Phone 390×844 and desktop 1440×900 checked; fixed the cramped phone tray and rechecked. No application console errors; upstream Three.Clock deprecation warning remains.

The interaction phase left the local server on **http://localhost:3002/**. The later Morphogenesis investigation above describes the current specimen. Changes are local, not committed/pushed/deployed. Usage, boundaries and repeatable checks: [`docs/INTERACTIONS.md`](docs/INTERACTIONS.md).

## User feedback phase (2026-10-11) — COMPLETE

Current integration is at `http://localhost:3002` (the other ports are in use). This phase responds to organism
rendering, touch feedback, long-running Echo jobs, and verified visitor keys. Key checks use read-only Atlas
authentication; agent QA submitted no paid jobs and spent no credits. Changes have not been pushed or published.

| Area | Current state |
|---|---|
| Membrane parameters | Genome and tissue metrics vary reflectance, absorption, layers, rays, interaction, and style within the documented API bounds. The deterministic parameter sweep passes. |
| Touch and probes | Linked organism/artifact probes work in both directions. Touch creates a wound; Inspect pins a read-only point on the specimen and linked artifacts without adding one. Pulse stimulates the membrane without recording a wound. Queued touch is consumed by Resume Evolve. |
| Render budget | DPR ≤1.5, 160×100 sphere mesh, MSAA 2, 30 fps target with a specimen / 15 fps blank, and hidden-tab pause/resume. Browser checks passed; no device CPU or universal frame-rate benchmark is claimed. |
| Audio | Muted playback suspends the audio graph; visual samples run at 20 Hz and the PCM cache holds four entries. |
| Moth key | Removed the BYOK badge and disconnected-field disclaimer. Check key verifies the entered key with read-only Atlas `/me` and shows Accepted/Rejected/unavailable status. Accepted keys are used for Create/Evolve and held only in browser memory. Editing invalidates acceptance; clearing restores the app key. Each chain captures its key, Resume requires the original credential, and cached skin is re-uploaded across credential scopes. Proxy clients are request-scoped; asset downloads are no-store and vary on Authorization. |
| Echo recovery | 20-minute initial client polling budget. Stop/Resume and timeout, poll, result, output, and terminal retry regressions pass; recovery continues the same job id and is memory-only (it does not survive reload). |
| Verification | Production build, final TypeScript/lint, surface (363), mask (98), membrane parameter sweep, Echo recovery regressions, and Apple GPU temporal check pass. Feedback browser QA passes key controls, Pulse/touch, queued-touch resume, render budget, hidden pause/resume, and PNG capture; recovery requests are mocked GETs with zero paid submissions. Stable free journey rerun passes 51/51 with zero unexpected errors, failed requests, or Atlas calls. Inspect follow-up passes TypeScript/lint and browser checks for touch-created wounds and pinned read-only inspection. |

Inspect follow-up note: a mis-targeted browser click accidentally started a live Evolve during manual QA. I stopped the local client at Membrane; the UI indicated Atlas may still be processing the submitted job. I did not resume it, and restored archived `42AC` generation 1 in the local preview. Remote job and credit state are unknown.

Temporal evidence: 15 states / 2,700 samples, minimum brightness 71.31, lit ratio .993, zero errors/API calls; report at [`/private/tmp/chrono-feedback-flicker-fixed/report.json`](/private/tmp/chrono-feedback-flicker-fixed/report.json). The initial transparent-canvas alert was a WebKit QA false positive caused by an early `getContext` probe; the probe was removed after compositor screenshot/A-B confirmation. The Echo negative control remains meaningful: the previous renderer fails the halo check (91.99 > 55), while the fixed renderer passes.

See [`docs/FEEDBACK.md`](docs/FEEDBACK.md) for rationale and final QA notes. Atlas queue/execution time is external; no sub-20-second SLA is claimed.

### Key verification follow-up

- ✅ `scripts/verify-moth-key.ts`: genuine identity-shape check, no missing/invalid-key fallback, safe errors, request-scoped credentials, all browser transport operations, and distinct-key uncached downloads.
- ✅ `scripts/qa/key.mjs`: Accepted/Rejected/unavailable states, stale response protection, panel remounts, no browser persistence, archive skin re-upload, custom/default Create Authorization, and reload clearing. Unchecked keys cannot start runs; changing keys blocks Resume until the original key is checked, then resumes the same job without a duplicate submission. State/logs never serialize the key. Paid calls are mocked. Evidence: `/private/tmp/chrono-key-final/report.json`; screenshot: `/private/tmp/chrono-key-final/key-accepted.png`.
- ✅ Live local `/api/moth/key/check`: configured key → 200 / Accepted; invalid dummy → 401; missing key → 400. Responses contain no credential or identity; no cookies and no-store. Manual browser QA confirmed Rejected, then Clear → Using app key while preserving the user's specimen.
- ✅ Production build includes `/api/moth/key/check`; TypeScript, lint, Echo recovery regression, and independent review pass. No dependencies added.

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

## UX and engine workload follow-up

- ✅ Create unlocks the Web Audio context in the click gesture and enables audio; playback begins once the chain produces its voice/echo artifact. Users can mute with the existing toggle.
- ✅ Every Evolution engine panel now puts Artifacts first, immediately below its stage header.
- ✅ Active engine status occupies the former Live-pill row at the top of every Evolution engine header; the title row stays clear.
- ✅ Morphogenesis requests 256 shots per colour field (down from 1,024). Membrane preserves the 1–4 Soma-derived layers, caps incoming rays at 4, and requests 24×24 LUTs (down from 48×48).
- Cause: observed rail times were 35 s for Tessa and 4:07 for Entanglement Shader. These are elapsed job times from submission through Atlas completion; polling adds only about 1–3 s. The code reduces expensive work, but Atlas queue/execution is external and a sub-20-second wall-time guarantee cannot be verified without new paid jobs.
- ✅ `npx tsc --noEmit -p .`, `npm run lint`, `npm run build`, `npm run build:next`, the free browser journey (51/51), Create-audio browser check and Artifacts-first checks across all eight panels. No Atlas jobs were submitted.

## Current behavior

Chrono chains eight Moth Atlas engines: QRNG → Graph → Tessa → Blur → Blur Core → Entanglement Shader → QRC Audio → Retrocausal Echo. Visitors explicitly Create or choose an archived specimen. Touches queue wounds; Evolve runs the five downstream stages. One panel explains inputs, engines, artifact provenance and their effects on the organism. The archive contains five specimens, including the regenerated `42ac05-g1`.

Headless screenshots use software WebGL and do not establish a GPU frame-rate benchmark. Engine latency remains variable. Submission form upload and a narrated competition video are separate from this code release.

## Visual identity and metadata: complete

- ✅ Original monochrome phase C mark, redrawn as editable SVG after built-in image generation concept exploration. White/dark lockups and transparent PNGs are in `public/brand/`; the live header uses the mark beside the Geist wordmark.
- ✅ Replaced the default favicon with 16/32/48px ICO frames; SVG/PNG browser icons, 180px Apple icon, 192/512px app icons and a separate maskable icon.
- ✅ 1200×630 social card featuring a real Chrono specimen. Canonical URL, description, Open Graph, Twitter, image alt text, Apple settings, manifest, theme colour, robots and sitemap configured. Labs explicitly noindex.
- ✅ Next build, Worker build, lint and TypeScript pass. `scripts/qa/brand.mjs` verifies served assets, icon dimensions, ICO frames, social metadata and desktop/360px layout against the built Worker with no engine calls. Lab noindex also verified in server HTML.
- Design rationale, exports and the generation prompt: `docs/BRAND.md`. Rebuild exports with `node scripts/generate-brand.mjs`. No packages added; no Atlas credits spent for branding checks.

## Initial black-frame fault: fixed

- ✅ Critic reproduced whole-stage disappearance on the public site/Apple GPU and isolated it to Echo shells. UI/canvas lifecycle and specimen data were intact.
- ✅ Clamp Echo's normalized dot to `[0, 1]` before fractional Fresnel powers; GPU rounding could otherwise produce invalid colour/alpha and contaminate compositing/bloom. Replaced two signed Gaussian powers with multiplication as additional shader hardening.
- ✅ Controlled WebKit/Apple GPU A/B: removing only the clamp recreated the black frame (mean centre brightness 0.0586/255); the fixed renderer passed 2,700 sampled frames in 15 states over three final specimens, with all centre pixels lit. Critic separately watched Echo, Membrane Compare and Soma overlays remain stable. Existing 363 surface regressions pass.
- ✅ TypeScript, lint, Next production build and deployment Worker build pass.
- Evidence, test commands and scope: `docs/FLICKER-QA.md`; repeatable temporal test: `scripts/qa/flicker.mjs`. No npm dependencies or Atlas calls added. The Playwright WebKit browser binary was downloaded for hardware-backed regression testing.

## Echo surface flashing: fixed

- The user supplied `glitch.mp4`: a close view of Specimen 4C42 with Echo ghosts and Echo shells enabled. Unlike the earlier black frame, pale overlapping copies wash over the visible organism. The earlier centre-pixel test did not detect this kind of flashing.
- ✅ Additive, order-independent Echo blending, tap-count-normalized/capped opacity and bounded, smoothly fading shell travel keep the body readable. The previous Fresnel clamp remains intact.
- ✅ Apple GPU A/B: restoring old Echo rendering fails body-colour and halo-brightness checks; fixed depth-12 rendering passes 180 frames. Close views at one/twelve taps and high audio activity also pass. The 51-check free journey, 2,700-frame visibility regression and 363 surface checks pass. Diagnosis and commands: `docs/ECHO-STABILITY-QA.md`.
- ✅ Removed the Evolution panel's LIVE pill. Browser smoke confirms following still shows Pin, Pin stops following, and no Atlas calls are made.
- ✅ TypeScript, lint and Next production build pass. No dependencies added or Atlas credits spent.

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
