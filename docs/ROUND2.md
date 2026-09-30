# Chrono — Round 2 brief (read after docs/BRIEF.md)

Round 1 shipped a working 8-engine chain. Round 2 fixes what the first real user pass exposed. Requests, verbatim in intent:

1. **The decoherence mask does not form nicely.** Investigate + fix.
2. **The right panel toggle:** switching immediately from the *input parameters* panel to the *respective evolution* panel.
3. **A plain-English description section** for each engine, under each evolution panel.
4. **Every new user starts at "New specimen" and nothing starts by itself.** The user must press the primary button, which reads **Create** for a new specimen and **Evolve** afterwards.
5. **Make the effects of Decoherence, Soma and Membrane visible on the actual blob, and make the relation between engine and blob obvious.** Today the effect is too subtle and the user cannot tell which engine did what.

Theme to stay inside: quantum organism · daisy chain of engines · *Chrono* = time · monochrome UI, the organism is the only colour · no filler text.

## 1. Mask diagnosis (already done — pipeline/mask agent fixes it)

- **Vertical flip (reproduced):** the viewport stores wounds with `v = 1` at the NORTH pole = TOP row of every image (three.js `uv.y`, shader `dirToUv`). `renderWoundMask` treats `v = 0` as the top row. A click near the top of the blob paints its wound near the bottom of the mask, so blur-v1 ages the wrong latitude. `MaskPreview` in `src/components/ui/artifacts.tsx` has the same flip.
- **Not round on the sphere:** wounds are Gaussians in flat image space (dx² + dy² in pixels). On an equirectangular map that is ~2× wider in longitude arc than latitude arc at the equator and smears near the poles. They must be Gaussians in **great-circle distance**.
- **Weak contrast:** baseline 0.35 everywhere + blur strength 0.55 means wounded and unwounded tissue barely differ. Keep the baseline non-zero (Atlas can reject a blank upload) but make wounds clearly read.
- **Blocky:** the mask is only as large as Tessa's skin (21–32 px) and is shown with nearest-neighbour scaling.
- Convention (now documented on `Wound` in `types.ts`): `Wound.v = 1` is the north pole / top image row. Image consumers must flip: `row = (1 - v) * height`.

## 2. Shared contracts (orchestrator-owned, additive-only)

`src/lib/chain/types.ts`: `LensState`, `LENS_OFF`, `Probe`. `src/lib/store.ts` (`useChrono`): `lens`, `setLens(p)`, `probe`, `setProbe(p|null)`, `resetToNew()`.
`src/lib/chain/stageCopy.ts`: `STAGE_COPY[stage]` (`gist`, `what`, `onBlob`, `controls`, `lens.{without,with,overlay}`) and `PARAM_COPY[control]` (`label`, `hint`, `stages`). **All user-facing engine/parameter text comes from here; do not write your own.**

### Chrono Lens (the idea)
The organism is the only thing on screen that tells the story, so each engine gets a **lens** that isolates *its* contribution on the same blob:
- `lens.stage` = engine being showcased (null = normal render). `lens.amount` 0 = organism **without** this engine → 1 = **with** it (the viewport eases; scrubbing shows the transformation live). `lens.compare` = hemisphere wipe (one half without, other half with, on the same blob). `lens.overlay` = draw the engine's diagnostic overlay on the surface.
- The UI sets the lens when a stage is opened in the evolution panel (`{ stage, amount: 1, compare: false, overlay: true }`) and resets it to `LENS_OFF` when the panel returns to Parameters.
- **Reveal pulse (viewport-internal):** when a stage finishes during Create/Evolve (status → `done`, not `cached`), the viewport plays a ~2 s reveal of that stage's effect (amount 0 → 1 with overlay fading out) so the user sees what each engine just did, even with the lens off. Never while the user is dragging.

Per-stage semantics (what "without" → "with" means, and the overlay):

| Stage | without → with | overlay |
|---|---|---|
| 01 Genesis | smooth seed sphere → genome silhouette (lobes) | genome bits as sparks on the surface |
| 02 Colony | blank → nuclei + cell relief | nuclei markers + cell walls |
| 03 Morphogenesis | raw colony picture → Tessa skin | texel grid |
| 04 **Decoherence** | fresh skin → aged, scarred tissue | wound-mask heat on the surface (warm glow where the mask is high) + rings at each wound centre |
| 05 **Soma** | smooth sphere → warped body | iso-contour lines of the displacement field, warm = outward, cool = inward, plus thin **entangled links**: glowing chords through the interior joining a bump to its dent on the opposite side (top ~6 peaks) |
| 06 **Membrane** | matte tissue → iridescent | thin-film **angle bands**: iso-lines of the view angle θ tinted by LUT phase, so the pattern the LUT paints is visible |
| 07 Voice | still → breathing with the song | equatorial ring displaced by the audio spectrum |
| 08 Echo | dry → echo ghosts | translucent shells pulsing outward at the echo tap delays (inverted taps darker) |

### Linked probe (viewport ↔ panel)
`probe` links the 2D artifact previews in the evolution panel with the 3D blob. Hover the blob → `setProbe({u,v,source:"blob",theta,phase})` → previews draw a crosshair at (u,v) (Membrane also marks the LUT at θ/phase; Soma also marks the antipode `(u+0.5 mod 1, 1-v)`). Hover a preview → `setProbe({u,v,source:"panel"})` → the blob shows a ring at that spot. Clear on pointer-out.

## 3. UX spec

### Start flow ("New specimen" first, nothing auto-starts)
- On load: `specimen = null`, all 8 rail nodes idle, the organism is the **embryo**, Parameters tab active. `bootstrap()` loads the archive **list** only — it must NOT open a specimen. Nothing calls the chain until the user presses the primary button.
- Primary button (right panel footer, visible on both tabs): label **Create** when `specimen == null`, **Evolve** otherwise (badge = pending wound count only in Evolve). While running it shows progress / Stop as today.
- **New specimen** = `useChrono.getState().resetToNew()` (blank state; keeps the slider values). It never grows by itself. Only shown when a specimen exists. Keyboard: Space = primary action, N = new specimen.
- Remove the centre "Grow a specimen" button of `EmptyState`; keep at most a quiet one-line label. The "Touch to decohere" hint appears only once a specimen exists.
- Archive drawer still opens archived specimens on request (then the button reads Evolve).
- Viewport must handle **specimen → null** (New specimen after a specimen was shown) by dissolving back to the embryo, not popping.

### Right panel (desktop; bottom sheet on mobile) — one panel, two views
- Header: segmented toggle **Parameters | Evolution**. Evolution shows a stage stepper (01–08) with prev/next.
- **Switching is immediate** (no waiting on animation; a ≤150 ms crossfade is fine): clicking a rail node, pressing 1–8, pressing a parameter's stage link, or the toggle itself swaps the panel at once. Esc returns to Parameters. The old separate Inspector slide-over disappears; its content becomes the Evolution view.
- **Follow mode:** while Create/Evolve runs and the user has not chosen a stage manually, the Evolution view follows the *running* stage (so the wait is spent reading what each engine does). Any manual choice ends following for that run.
- **Parameters view:** the four controls (Circuit depth, Entanglement, Decoherence, Simulator), each with `PARAM_COPY.hint` under it and a small link chip → the engine(s) it steers (`PARAM_COPY.stages`). Footer with the primary action.
- **Evolution view, in this order:**
  1. Stage header: `04 · Decoherence`, engine name + id, status pill, `gist`.
  2. **What it does** — `STAGE_COPY.what` (the description section).
  3. **On the organism** — `STAGE_COPY.onBlob` + the Lens controls: **Without | With** segmented (labels from `lens.without/with`), a 0–100 % scrub slider, **Compare** toggle, **Overlay** toggle (label from `lens.overlay`). Disabled with a quiet note before Create.
  4. The engine's own controls, if any (`STAGE_COPY.controls`): the same sliders/toggle, bound to the same state as the Parameters view.
  5. Artifact preview (existing) — image previews are smooth-scaled, not pixelated, and take part in the linked probe.
  6. Collapsible **Run details**: coupling note, params table, job id, latency, attempts.
- Before Create the Evolution view still works as documentation (descriptions, controls); artifact area says "Waiting for Create".

### Effects must be legible even with the lens off
- Soma displacement clearly visible (raise amplitude / normalise by field variance), Decoherence aging + scars clearly visible (desaturation, erosion, scar rims, wound heat that fades), Membrane iridescence clearly visible with strong angle dependence.
- `controls.entanglement` and `controls.decay` preview live on the blob (coupling strength and aging amount) before the engines re-run; the UI marks slider values that differ from the specimen's `controls` as "pending" until Evolve.

## 4. Ownership (unchanged rule: stay in your files)

| Agent | Owns |
|---|---|
| mask | `src/lib/imaging/mask.ts`, the decoherence stage in `src/lib/chain/pipeline.ts`, `scripts/verify-mask.ts` |
| viewport | `src/components/organism/**`, `src/app/lab/organism/**` |
| ui | `src/components/ui/**`, `src/hooks/**`, `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css` |
| orchestrator | `types.ts`, `store.ts`, `stageCopy.ts`, docs |

## 5. Rules for everyone

- Ports: ui `3101`, viewport `3102`, mask `3104`; never `3000`. Use `NEXT_DIST_DIR=.next-<agent> npx next dev -p <port>`. Next.js 16: read `node_modules/next/dist/docs/` before touching routing/layout APIs.
- See the app without a browser extension via `scripts/qa/harness.mjs` (headless Chromium, WebGL on SwiftShader ≈ 2–4 fps). **Look at your screenshots with the Read tool and iterate.** Zoom crops with `sips -c <h> <w> --cropOffset <y> <x> in.png --out out.png`.
- Dev handle: `window.__chrono` (shared store) / `window.__chronoUi`. To get a specimen on screen for testing, use the Archive drawer, or `__chrono.getState().setSpecimen(...)` after fetching `/specimens/<id>/manifest.json`.
- No new npm packages. Type-check with `npx tsc --noEmit -p .` (run `npx next typegen` once if `LayoutProps` is missing). Do not commit; the orchestrator does. When done, restore `tsconfig.json` with `git checkout -- tsconfig.json` **only if** you did not intentionally change it.
- Final report: files changed, how you verified (with the screenshot paths you looked at), anything unfinished.
