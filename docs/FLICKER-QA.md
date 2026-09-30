# Final-form disappearance: diagnosis and verification

2026-09-30. A browser QA critic observed the published app on the actual Apple GPU. After loading `42ac05-g1` and opening Echo, the entire WebGL stage went black and then returned about 2.5 seconds later. UI controls stayed present. Echo Dry (0%) remained stable, isolating the shell rendering path.

## Cause and fix

`shellsFragment` calculated `abs(dot(normalize(vN), normalize(vV)))` and then used `pow(1.0 - ndv, 2.2)` for the Fresnel rim. GPU rounding can put that dot product slightly above 1, making the fractional power's base negative. Invalid shell colour/alpha then contaminates compositing and bloom, so the whole rendered stage can disappear. The stage was not being unmounted or culled.

Clamp the normalized dot to `[0, 1]` before evaluating the Fresnel powers. The intended Echo animation, opacity and shell count remain intact. Also replace the two signed Gaussian `pow(x, 2.0)` expressions (scar rims and Soma link nodes) with `x*x`; this preserves their shape while removing another undefined shader domain. GLSL defines `pow` with a negative base as undefined, even for exponent `2.0`: [Khronos GLSL ES specification, §8.2](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf).

## Controlled regression

`scripts/qa/flicker.mjs` samples the organism's central pixels across consecutive rendered frames, rather than checking only a still image. It uses existing Playwright with WebKit on Apple GPU. No Atlas calls or credits are required.

- **Control:** Removing only the Echo dot clamp from the fixed shader in an isolated dev browser reproduced the disappearance in Parameters. Of 180 sampled frames, minimum centre brightness was **0.0586/255**, with only **0.098%** of centre pixels lit. Browser errors remained empty. This reproduces the exact causal shader path without changing opacity or the body shader.
- **Fixed:** **2,700 frames across 15 states** passed: `42ac05-g1`, `308761` and `6a5efd`, each in Parameters, Echo, Echo shells overlay, Membrane Compare/light bands, and Soma contours/links. **100%** of centre pixels remained lit in every sample. Minimum mean brightness was **87.7/255**. Dev animation runs at 8× speed to exercise repeated shell phases.
- The critic independently watched the fixed native browser through multiple Echo phases (~13 seconds), Membrane Compare and Soma overlays. The body stayed visible and the console stayed clean.
- The 363 existing surface/picking regressions pass; geometry, wound coordinates, lens reveal lifecycle and reset behavior remain unchanged.
- TypeScript, lint, the Next production build and the deployment Worker build pass.

```bash
# Download a test browser binary once if it is not already installed (no npm dependency change):
./deck/node_modules/.bin/playwright install webkit
# With the root-owned Next dev server running:
node scripts/qa/flicker.mjs http://localhost:3000 /private/tmp/chrono-flicker-fixed
# A/B control deliberately restores the old Echo expression in that browser; expected to fail:
node scripts/qa/flicker.mjs http://localhost:3000 /private/tmp/chrono-flicker-baseline webkit --baseline
# A built Worker can also be checked, with 14 real seconds per state:
node scripts/qa/flicker.mjs http://localhost:3103 /private/tmp/chrono-flicker-worker
```

Raw local evidence: `/private/tmp/chrono-flicker-fixed/report.json`, `/private/tmp/chrono-flicker-baseline/report.json`, and `/private/tmp/chrono-flicker-baseline/failure.png`. Unlike the earlier SwiftShader checks, these tests cover the Apple GPU backend that actually showed the fault. They are not a general performance benchmark.
