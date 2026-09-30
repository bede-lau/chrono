# Round 2 verification — 2026-09-30

Round 2 finishes the five requests in `ROUND2.md`: spherical wound masks, immediate Parameters/Evolution switching, engine explanations, explicit Create from a blank start, and visible engine contributions through the Chrono Lens.

## Automated checks

- `npx tsx scripts/verify-mask.ts`: 98/98 checks; north-up orientation, great-circle shape, seam/pole continuity, supported image dimensions, contrast and determinism.
- `npx tsx scripts/verify-surface.ts`: 363 surface-to-ray-to-UV samples, maximum UV error 0.0000021; transient ripples, image orientation, Echo comparison, reveal lifecycle and embryo reset also pass.
- `npx tsx scripts/verify-start-flow.ts`: listing the archive never selects a specimen or calls an engine; New specimen resets organism state and retains controls.
- `npx tsx scripts/verify-audio.ts`: all 10 generated WAV chunks pass finite-value, clipping and duration checks.
- `npx tsx scripts/verify-specimens.ts`: all five committed specimens have valid images, audio, LUTs and engine provenance.
- TypeScript and source ESLint: clean. Generated build directories are excluded from lint.

## Archive regeneration

`42ac05-g1` was regenerated from `42ac05` with four wounds and the corrected mask. It completed in 65 seconds on the first attempt for every downstream engine:

| Stage | Engine time |
|---|---:|
| Decoherence | 4.2 s |
| Soma | 3.2 s |
| Membrane | 18.2 s |
| Voice | 20.6 s |
| Echo | 9.1 s |

The saved manifest contains the actual job IDs, inputs, coupling notes and new output assets. Mask baseline is 0.15; its dimensions match the 32×32 skin.

## Visual and interaction review

Desktop 1280×800 and mobile 390×844 were inspected. The new visitor sees an embryo and Create without Moth requests. Panel tabs, rail selections and shortcuts switch views immediately. The mobile sheet has no horizontal overflow.

Decoherence visibly changes fresh skin into cracked, aged tissue; Soma alters the silhouette and shows linked bumps/dents; Membrane changes matte tissue into angle-dependent iridescence. Linked probes work in both directions, including Soma's antipode. Real clicks near the top and bottom produced `v=0.715` and `v=0.385`. Reset returns the viewport to the embryo and clears artifact contributions.

Additional integration fixes: comparisons preserve Echo shells unless Echo is the selected engine; CPU picking includes the shader's transient ripples and audio shiver; keyboard focus follows view changes; leaving Evolution clears the probe; resetting a specimen stops its audio and invalidates stale decodes while retaining the sound preference.

## Browser journeys and builds

- Free journey: the initial combined run passed 47/47 checks. The final expanded run passed 51/51, including the real Archive drawer and separate assertions for each keyboard stage. It made no Moth requests and recorded no browser errors.
- Live journey: Create completed all eight engines in 146 seconds; Evolve completed all five downstream engines in 80 seconds, retaining three cached stages. The evolved specimen was `F56E`, generation 1. The three clicked wound samples were 251, 252 and 253 against baseline 38; their north/south mirrored samples were 180, 247 and 159.
- All 54 functional assertions in that live run passed. Its original broad console assertion flagged three HTTP 422 seed-upload rejections. Server logs confirm the next seed upload succeeded, after which Tessa and the rest of both chains completed. The harness now records HTTP failure details and only permits a documented `not a valid asset` seed rejection after both live chains complete. Classification checks confirm that mask failures, other messages, uncompleted chains, extra console errors and page errors still fail. No extra paid grow was spent solely to rerun the logging assertion.
- `npm run build`: succeeds, producing the Cloudflare Worker bundle. `npm run build:next`: succeeds, with all five API routes dynamic.
- Built Worker on localhost:3103: browser smoke passes blank boot, WebGL, Archive selection, Membrane Compare and New specimen. Development store handles are absent, with zero API calls and zero browser errors.
- Independent read-only integration review: no blocking findings.

Run the free browser journey against `npm run dev`:

```sh
node scripts/qa/e2e.mjs http://localhost:3000 /private/tmp/chrono-e2e
```

Add `--live` to exercise all eight engines through the browser proxy, then click wounds and Evolve through the five downstream engines (about 31 credits). The script also checks the actual returned mask against those wound coordinates. A separate archive regeneration uses about 10 credits.

Screenshots render with software WebGL in headless Chromium; they verify appearance and behavior, not production GPU frame rate.

Committed captures: `docs/screenshots/round2-new-specimen.png`, `round2-decoherence.png`, `round2-soma.png`, `round2-membrane.png`, and `round2-mobile.png`.
