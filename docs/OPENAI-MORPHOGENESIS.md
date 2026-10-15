# OpenAI Morphogenesis

On 2026-10-14 the user authorized replacing the failing Tessa image engine with OpenAI image editing, with no frontend changes. The seven remaining stages still use Moth. This creates a model-generated membrane rather than Tessa's quantum encode/measure/decode result.

## Backend behavior

`POST /api/moth/engines/tessa-image-v1/process` preserves the existing browser contract. It downloads the uploaded Colony seed with the current Moth credential, sends a 256×256 reference to OpenAI Images Edits, requests one low-quality 1024×1024 PNG, then area-resamples RGB to the seed's original dimensions while retaining its alpha. The prompt preserves cells and palette and asks for flat biological membrane detail with tileable horizontal edges. The result is uploaded as a real Moth asset, enabling the unchanged downstream Blur input.

The request awaits generation/upload before acknowledging completion. Status/result URLs use an HMAC-signed receipt with a seven-day lifetime, scoped to the Moth API base and current credential. They require no process-local registry. Results record `provider: openai`, model and request ID. Ordinary Moth UUID jobs retain their existing behavior.

Required server environment variables are `OPENAI_API_KEY` and a stable random `OPENAI_IMAGE_JOB_SECRET` of at least 32 characters. `OPENAI_IMAGE_MODEL` defaults to `gpt-image-2.5-flare`. Keys remain in ignored server configuration; the visitor's Moth key field does not configure OpenAI. Keep the receipt secret stable across instances/restarts. No npm packages were added.

OpenAI has a 180-second transport deadline and makes one paid attempt. Provider errors are sanitized and non-retryable by the generic poller. A manual retry can make another paid request. Stop can abort the pending HTTP request; a disconnected request has no resumable receipt until generation/upload has completed. There is no detached background work or local skin fallback. Production hosting must allow the synchronous request duration; the route declares a 240-second maximum, and upstream asset transfer can add time around generation.

## Frontend restriction

All 84 existing non-API source files were checked against a pre-edit SHA-256 snapshot and remain unchanged. Consequently the UI still says Tessa Image / Quantum skin and displays the old simulator/shot controls and coupling description. These no longer configure or describe the OpenAI edit; backend provider metadata is accurate. Updating that copy requires a separate frontend change authorized by the user.

## Verification

The browser completed a real Create on localhost:3002, Specimen F2C3, generation 0. Timings below are rounded values displayed by the unchanged UI, not a latency guarantee.

| Stage | Duration |
|---|---:|
| Genesis | 17 s |
| Colony | 5.8 s |
| Morphogenesis (OpenAI) | 19 s |
| Decoherence | 4.8 s |
| Soma | 3.7 s |
| Membrane | 12 s |
| Voice | 20 s |
| Echo | 13 s |

Exactly one OpenAI image attempt succeeded. OpenAI request ID: `req_f0d4dbb2473d4f1aa183cfe0d60ff9c0`. Generated Moth asset: `ba26ae8c-149d-49de-a673-6b08ce92a1e4`, normalized to 16×16 / 996 bytes. All subsequent stages completed and the finished organism rendered. Browser console had zero errors and the existing Three.Clock deprecation warning.

Offline checks:

```sh
npx tsx scripts/verify-openai-images.ts
npx tsx scripts/verify-openai-membrane-job.ts
npx tsx scripts/verify-morphogenesis.ts
npx tsx scripts/verify-echo-resume.ts
npx tsc --noEmit -p .
npm run lint
npm run build
npm run build:next
```

The image tests cover request shape, PNG bounds, resampling/alpha, cancellation/deadline, and safe provider failures. Job tests cover completed-output compatibility, credential isolation, tamper rejection, expiry and avoiding automatic paid retries. Screenshot: [finished specimen](screenshots/openai-image-swap.jpg). No changes have been committed, pushed or deployed.

All listed checks passed. Next was built in an isolated output directory to preserve the live dev server. Running vinext first rewrites `.next/types/routes.d.ts` in a format incompatible with stale Next validators; `npx next typegen` regenerated those disposable types before the successful Next build. The existing TypeScript configuration was restored byte-for-byte. Both client output trees were scanned with zero matches for the configured OpenAI key or receipt secret.
