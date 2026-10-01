# Echo surface flashing: follow-up diagnosis

2026-10-01. The supplied `glitch.mp4` shows a newly created Specimen 4C42 with Echo ghosts at 100% and the Echo shells overlay enabled. Large pale copies overlap the body and wash over its colours. This differs from the black-stage arithmetic failure recorded in `FLICKER-QA.md`: centre pixels can remain lit while the organism is obscured, so the earlier visibility test did not cover this report.

## Cause and change

Echo draws up to twelve copies of the body in one instanced mesh. The old material used normal alpha blending, which depends on the order of overlapping layers. The instances keep their draw order while their animated radii change; each layer also carried unnormalized opacity, so high-depth echoes could cover the organism with a pale stack.

The renderer now uses additive, order-independent composition for these ghosts. Each tap's opacity is divided by the tap count and capped; its maximum radial expansion is 18.3% rather than 56%. A smooth envelope fades each tap to zero before its phase wraps. The dry body, audio processing, circuit depth and lens controls are preserved, as is the earlier clamp protecting the Fresnel calculation.

The Evolution panel's LIVE pill was removed. Following the running engine and the Pin control still work.

## Controlled verification

`scripts/qa/echo-shells.mjs` uses WebKit/Apple GPU and the real development renderer with twelve taps. It compares body colour and the surrounding halo with a Dry reference, then samples 180 consecutive frames for abrupt changes. Its `--baseline` mode restores the old Echo geometry, opacity and blending in that isolated browser while retaining the earlier arithmetic fix.

- Old rendering: halo brightness 91.2/255; body chroma 26.3 versus Dry 48.7. The body-colour and stage-brightness checks fail.
- Fixed rendering: halo brightness 29.9/255; body chroma 44.8 versus Dry 48.7; maximum mean adjacent-frame difference 0.71/255. The focused regression passes and the halo is still visible.
- The debugger and root inspected app-only before/after screenshots. The fixed view keeps the coloured skin readable beneath a restrained halo.
- Close-zoom endpoint checks cover one and twelve taps, with 180 rendered frames each. Body chroma remains 82.6% and 89.0% of the respective Dry references; maximum mean adjacent-frame differences are 1.33 and 1.36/255. Both retain a visible halo. The focused regression also requires Echo's surrounding brightness to exceed its Dry reference, rather than merely checking for nonzero pixels.
- With audio enabled and a conservative high audio level in the isolated renderer, the close-zoom twelve-tap view retains 95.7% of Dry body chroma. Maximum mean adjacent-frame difference is 3.97/255 versus Dry 4.24/255; no console errors or Atlas calls occur.
- Browser smoke confirms the LIVE tag is absent during following, Pin still stops following, and no Atlas calls are made.
- The free user journey passes 51 checks, including lens controls, wounds, following/pinning, audio, reset and mobile layout. The previous visibility regression still passes 2,700 Apple GPU frames in 15 states over three archived specimens. All 363 surface/picking checks pass.
- TypeScript, lint and the Next production build pass.

```bash
# Root-owned Next dev server:
npm run dev
# Fixed high-depth regression:
node scripts/qa/echo-shells.mjs http://localhost:3000 /private/tmp/chrono-echo-fixed
# Restores old Echo rendering in this browser; expected to fail:
node scripts/qa/echo-shells.mjs http://localhost:3000 /private/tmp/chrono-echo-baseline --baseline
```

Raw local reports and screenshots are in `/private/tmp/chrono-echo-fixed/` and `/private/tmp/chrono-echo-baseline/`. The user's recording and its extracted frames remain outside the repository. These checks use archived artifacts and require no Atlas credits or new npm dependencies.
