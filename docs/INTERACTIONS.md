# Local specimen experiments

Pressure test, Entangled tug, Rhythm play and Light probe are available from the interaction selector below a loaded specimen. Create a specimen or select one from Archive first. Experiments are available while the engine chain is idle; they do not submit Moth jobs, modify artifacts or add wounds.

- **Pressure test:** hold a point to indent it, drag to stretch it, and release for springback. The spring stiffness is derived from the specimen's Soma variance. The Hold to Press button provides a keyboard-accessible demonstration.
- **Entangled tug:** hold or pull a patch; the antipodal patch responds inversely, with strength governed by the Entanglement slider. A temporary cyan-to-amber trace identifies the connection, including its far side. Hold to Tug is the keyboard alternative.
- **Rhythm play:** tap the specimen, use Tap beat, or press Space. Select a tempo from 60–140 BPM and follow the beat indicator. Consecutive taps close to that tempo increase the sync streak, movement and synthesized call-and-response notes. Audio follows the existing mute setting; Unmute enables it explicitly.
- **Light probe:** drag on the specimen to move its camera-relative key light. The two sliders provide keyboard control; Reset returns to the studio-light position. This changes illumination and reflections, not the engine's membrane LUTs.

Touch still leaves a wound for a future Evolve; Inspect remains read-only; Pulse remains available. Switch to Touch or Inspect to orbit the specimen. Scroll zoom remains available in the experiments.

## Implementation boundaries

Transient experiment state lives in Zustand and resets on specimen/generation changes, new specimens, mode changes and chain starts. Surface gestures also release on pointer-up, cancellation, capture loss, Escape, blur and hidden documents. Pointer input captures the active pointer while dragging. Reduced motion reduces displacement and removes spring overshoot; the beat indicator is static for reduced motion.

GPU deformation is mirrored in the CPU surface sampler so picking and linked probes continue to address the visible surface. The existing 30fps budget and hidden-tab pause remain in force. Rhythm voices are bounded, stopped and disconnected after their short envelopes; muted specimen loads defer audio context creation and decoding.

## Verification

- `npx tsx scripts/verify-interactions.ts`: rhythm cadence/debounce, spring stability, direct and antipodal displacement, release settling, input guards and transient resets without changes to wounds/controls/artifacts.
- `npx tsx scripts/verify-audio-interactions.ts`: muted URL deferral, same-URL unmute loading, bounded voices, end cleanup and mute cancellation with mocked Web Audio/fetch.
- `npx tsx scripts/verify-surface.ts`: existing 363 picking samples and viewport regressions.
- `npx tsc --noEmit -p .` and `npm run lint`.
- Manual browser QA uses archived 42AC G1: hold/release Pressure, drag/release Tug, keyboard Rhythm with visible In sync streak, Light slider extremes and direct dragging, audio mute/unmute, and return to Touch with no queued wounds. Desktop 1440×900 and phone 390×844 layouts checked; phone tray width corrected after the initial pass. Console has no application errors (Three.js emits an upstream Clock deprecation warning).

Local preview: http://localhost:3002/. No engine jobs, dependencies, commits, pushes or deployments are required by these experiments.
