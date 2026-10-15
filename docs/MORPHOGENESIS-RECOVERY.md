# Morphogenesis timeout investigation — 2026-10-13

The local specimen `737aa0` reached Morphogenesis at 10:04:37 after successful Genesis and Colony stages. Tessa returned a terminal `engine_timeout` about a minute after each submission. Chrono retried the identical 32×32, 256-shot request six times, with 5, 10, 20, 40 and 60-second backoffs. The chain finally halted at 10:13:15. This was repeated upstream failure, not a stuck progress timer.

The final job (`2a433880-e89f-45e7-901e-2e3fa9a6d0ca`) was confirmed failed through the local status proxy: submitted 09:12:13 UTC, failed 09:13:15 UTC, error type `engine_timeout`. The live Tessa engine schema permits positive integer shot counts; image dimensions come from the uploaded PNG, not a resolution parameter.

## Repair

- Keep the original Colony image. Render a separate 16×16 Tessa input from the same measured colony and genome, initially at 128 shots. This reduces input pixels to a quarter and halves the shot count; it does not guarantee a proportional runtime reduction.
- Allow one 64-shot fallback only after an explicit terminal engine timeout. Never resubmit merely because the local polling window expires or a result/download is temporarily unavailable.
- Bound each Tessa polling window to 90 seconds, replacing the legacy 40-minute window. An unresolved remote job remains available through Resume.
- Retry the first failed stage while preserving completed stages. The primary action becomes **Retry Morphogenesis**, rather than creating a new genome and colony.
- Record the actual input image, parameters and retry budget so artifact previews and attempt counters describe the work sent to Moth.

## Verification

TypeScript, full lint, diff checks, `scripts/verify-morphogenesis.ts` and `scripts/verify-echo-resume.ts` pass. The Morphogenesis checks cover the two-attempt cap, reduced input, preserved Colony, manual retry, same-job recovery, no fallback for local/submit timeouts, and elapsed time including both attempts.

Browser QA retried the existing specimen without reloading or rerunning Genesis/Colony. It sent 16×16/128 shots (`8c826382-969e-4f00-b9a2-b13d0fbeb87f`), followed by 16×16/64 shots (`cba7fbb0-fcb0-41be-8932-a28839d0b010`). Both returned terminal upstream `engine_timeout`; the app halted at 10:34:21 after starting at 10:32:11. The UI correctly showed 1/2 then 2/2 and restored Retry Morphogenesis.

To distinguish a heavy specimen from upstream trouble, one diagnostic used an 8×8 input and only 16 shots (`b7c3da8a-2b84-4153-8db8-2d1c3f509159`). It also returned `engine_timeout` after 62.8 seconds. This supports an upstream Tessa service problem; reducing work did not restore live completion. No further requests were submitted. The diagnostic did not replace the user's specimen.

The retry amplification and recovery behavior are fixed locally. The current specimen remains partial until Tessa responds. The server is open at `http://localhost:3002/`; external queue and execution time remain controlled by Moth. These checks do not establish a sub-20-second runtime guarantee.

## Follow-up investigation, 11:36–11:43 UTC

The user explicitly requires all eight engines. Do not substitute a local skin, mark Tessa complete without a result, or bypass Morphogenesis.

Live engine metadata exposes `fixed_palette:true`, which sends one palette-index field instead of the three colour-sphere fields. This was tested as a possible repair, without changing the production request policy or the user's specimen:

| Diagnostic | Job ID | Result |
|---|---|---|
| Existing 16×16 input, `aer`, 64 shots, fixed palette | `ccb029e7-1af4-49f4-abc3-ea4adf09dd74` | Terminal `engine_timeout`, 63.1 s |
| Fresh four-pixel RGBA image, `aer`, 64 shots, fixed palette | `46967d65-943c-43a7-9dfd-074b73d20c93` | Terminal `engine_timeout`, 63.1 s |
| Same four-pixel image, `fake_fez`, 64 shots, fixed palette | `cd0a6ab0-b0d9-4021-a21a-9dba74542136` | Terminal `engine_timeout`, 62.9 s |
| Free `test-engine-v1` control, same credentials and transport | `e01754ad-6409-4fbd-a88b-7118c154710a` | Completed, 8.3 s |

The four-pixel input was a freshly uploaded PNG with red, green, blue and gold opaque pixels (asset `04c33a58-d0e5-4d9f-a500-c7b403c706c2`). This isolates image size, colour-field count, simulator choice, old asset expiry and the general authenticated transport. It is strong evidence of a failure in Tessa's remote execution path; it does not identify the inaccessible worker's internal root cause.

The active API accepts the documented JSON `input_files`/`params` body and reports each job as **failed**, not still queued. Its registry advertises `execution_mode:"handler"`, a five-hour run-policy timeout, and enabled status. The advertised multipart example endpoint `/v1/generation/tessa-image-v1/process` returns 404. There is no documented caller timeout override that can repair the terminal remote failure. Lengthening the browser polling window would not revive these jobs.

No speculative palette/backend changes were adopted because none passed live verification. The UI now attributes this error to Moth's Tessa engine, preserves the original technical error in Run details, and explains that Retry submits the stage again. The existing partial specimen remains intact, and the eight-engine requirement is unchanged. This follow-up made three Tessa diagnostic submissions and one verified-free control submission; no replacement specimen or downstream stage was run.

For the Tessa operator: inspect the three job IDs above and the handler's roughly 60-second RPC/dispatch deadline versus the advertised `run_policy.timeout:18000` seconds. The exact failing params for the smallest ideal-simulator reproduction are `{ "machine": "aer", "shots": 64, "fixed_palette": true }` with a 2×2 PNG passed in the `image` slot.

## Historical control, 11:52–11:54 UTC

At the user's request, compared the local code with `4b123edafe19fd514e36246ca73acd36d740179f`, the last commit documenting a verified full live Create before the shot-count reduction. Its Morphogenesis request matches `736f0fc`: a 32×32 PNG with `{ "machine": "aer", "shots": 1024 }`, default palette/RGB behavior, and a 40-minute client polling window. Commit `4c0dc6b` reduced shots to 256; the current uncommitted repair uses a separate 16×16 input at 128/64 shots. The colony renderer and PNG encoder did not change across these versions.

The control uses the exact saved input from successful archived specimen `6a5efd` in that commit. Its original Tessa job `c9ed8af0-c85b-4b8a-bc11-67f018339750` completed in 89.690 seconds. The 2,820-byte PNG has SHA-256 `7ffe8bb9f06c7a1338c801b0ef77b71f11099d45beb197b9361751fe4c260bd9`. Each new upload was downloaded again and checked against those bytes before submission.

| Live replay | Configuration | Job ID | Result |
|---|---|---|---|
| Historical client, transport and poller extracted directly from `4b123ed` | 32×32, `aer`, 1,024 shots | `34e8bd6b-ccce-4ab9-9bd7-b8d78dc0f871` | Terminal `engine_timeout`, 62.802 s |
| Current client through the local `/api/moth` proxy | Same exact input and original settings | `b9864bbb-438e-4d1f-9d44-83a584c62a29` | Terminal `engine_timeout`, 62.963 s |

Both tests retained the original 40-minute polling window and made exactly one submission each. Neither reached its local timeout. Disabling the historical six-attempt resubmission loop kept the diagnostic bounded without changing its first request or polling behavior. Both used the configured app credential; the current proxy test supplied no visitor key.

The old code and original workload now fail with the same remote error as the current code. This directly rules out the recent image-size/shot-count changes and shorter polling window as a necessary cause of the reproduced failure; bypassing the new proxy also did not recover it. It strongly supports a Tessa-side execution problem, but does not reveal Moth's internal root cause or establish that every possible input fails. Original settings were not adopted as a repair because they did not complete.

Reproduce with `node --env-file=.env.local --import tsx scripts/qa/morphogenesis-baseline.ts` (offline comparison), adding `--live` for two paid submissions. The live command saves a sanitized report and any successful output in a fresh temporary directory. This run's report is `/var/folders/sz/6kl9vb8j74b_tmlcv9xygwn80000gn/T/chrono-morph-baseline-v9ZWb1/report.json`.

TypeScript, lint for the diagnostic, diff checks and independent review pass. Browser inspection confirmed the original `737aa0` specimen, completed Genesis/Colony and Retry Morphogenesis remain intact. No app request settings were changed by this comparison, no downstream engines ran, and the server remains open on port 3002.

## Supported-parameter sweep, 13:03–13:10 BST

The user requested further configuration tests to make Tessa complete consistently without relying on a fallback. Fresh engine metadata confirmed that palette mode processes one index field, while `separate_rgb:false` merges the two angle fields into one circuit, reducing three circuits to two with a second measurement setting. `aer` remains the noiseless local simulator. Distortion was held at zero: nonzero distortion is explicitly unsupported on simulated per-group readout. Range correction changes decoded output rather than the circuit workload, so it stayed off. No caller parameter changes the engine's remote deadline.

`scripts/qa/tessa-variants.ts` tested six distinct configurations sequentially through the same local proxy used by the app. Every job had one attempt and a 120-second client window. There were no automatic retries, substitute skins, or downstream submissions. Input bytes were downloaded after upload and verified by SHA-256. Colony inputs were rendered from archived `6a5efd`'s measured Bloch vectors, correlations and genome; the two minimum-work diagnostics used the same fresh opaque four-colour 2×2 PNG.

| Input | Encoding | Shots | Job ID | Result |
|---|---|---:|---|---|
| 8×8 colony | Palette | 64 | `77f4a5cb-893f-484f-8f24-77edfaa83158` | Terminal `engine_timeout`, 64.411 s |
| Same 8×8 colony | Merged angles | 64 | `0e55baf6-5a1e-4628-bd27-1b233c406268` | Terminal `engine_timeout`, 62.815 s |
| 16×16 colony | Palette | 256 | `a3cc0d11-fa1c-49ec-983e-8ba6ab4e292e` | Terminal `engine_timeout`, 62.811 s |
| 4×4 colony | Palette | 16 | `3352f2e8-fc82-4f40-bdfb-5dc04801b114` | Terminal `engine_timeout`, 62.899 s |
| Four pixels | Palette | 1 | `d882cafd-8fe1-45c8-a37c-91f5157b2b03` | Terminal `engine_timeout`, 62.529 s |
| Same four pixels | Merged angles | 1 | `6a9ed067-672c-4d68-8b70-e187ea2691e9` | Terminal `engine_timeout`, 62.701 s |

All requests used `machine:"aer"`, `distortion:0` and `range_correction:false`. Palette requests used `fixed_palette:true`; merged-angle requests used `fixed_palette:false, separate_rgb:false`. The minimum positive shot count is one. Those one-shot trials diagnose the workload floor; a completed one-shot image would still need a quality check and would not automatically become an application default.

**No configuration produced a skin.** The time stayed within 62.5–64.4 seconds across 4–256 pixels, 1–256 shots, and both reduced-field encodings. None reached the 120-second client limit. This is evidence that the observed terminal timeout cannot currently be avoided by these workload changes; the inaccessible Tessa worker/dispatch path still needs investigation. The exact internal cause remains unknown. No candidate qualified for the planned three-specimen success checks, and no unverified request configuration was adopted. The existing eight-engine requirement remains in force.

The operator-ready report is [`moth/tessa-variants-2026-10-13.json`](moth/tessa-variants-2026-10-13.json), including exact params, input hashes, assets and job IDs. The smallest reproduction is a 2×2 PNG with `{ "machine":"aer", "shots":1, "fixed_palette":true, "separate_rgb":true, "distortion":0, "range_correction":false }`. Inspect the roughly 60-second engine response/dispatch deadline against the advertised 18,000-second run policy. Six jobs were submitted; actual billing/refunds were not queried.

Reproduce offline with `node --import tsx scripts/qa/tessa-variants.ts`. Adding `--live` and loading `.env.local` runs the bounded paid sweep (six available variants; eight submissions maximum including confirmations for usable fast candidates). The script stops if an accepted job remains unresolved, verifies supported params/cost against live metadata, and never imports or mutates the controller or browser store.

TypeScript, diagnostic lint, offline matrix checks and independent review passed. The local server had stopped before the sweep; it was restarted on port 3002. An initial attempt made zero engine submissions because uploads could not reach that stopped server; a preflight check now catches that condition. Browser inspection of the existing localhost tab was rejected by the browser's URL policy, so this phase has API verification only. No browser state was reset or edited by the sweep. The server remains running at `http://localhost:3002/`.

## Retest and validation diagnostic — 2026-10-14, 18:05–18:10 BST

The user requested another attempt because Moth had not responded. Fresh authentication succeeded, and Tessa's enabled status, parameter schema, updated timestamp and advertised run policy were unchanged. The local server had stopped between sessions and was restarted on port 3002.

| Request | Transport | Expected | Actual | Job ID |
|---|---|---|---|---|
| Fresh 2×2 four-colour PNG, `aer`, palette, 1 shot | Direct Atlas | Output PNG | Terminal `engine_timeout`, 63.094 s | `b2c5cce3-eaaa-4813-901b-41027a0ef086` |
| Same image content, `aer`, palette, 64 shots, `distortion:1` | Direct Atlas | Documented `distortion_without_hardware` rejection | Terminal `engine_timeout`, 63.063 s | `4bfcc589-8a04-4fa2-b863-3bfcba707cb4` |
| Current app configuration: 16×16 colony input, `aer`, 128 shots, default sphere fields | Local app proxy | Output PNG | Terminal `engine_timeout`, 63.153 s | `a540dcde-5050-45cf-b972-3a9222932094` |
| Free `test-engine-v1`, same configured credentials and API | Direct Atlas | Completed control | Completed, 8.486 s | `66075a0d-eedc-46f0-94e9-fc9dbf5134d7` |

The practical input was freshly rendered from archived specimen `6a5efd` using the same colony renderer and 16×16 dimensions as the current application. It did not replace or use the browser's partial specimen. All fresh uploads were downloaded again and verified by SHA-256. Each Tessa test submitted exactly once with a 120-second client window, so the three observed remote failures preceded that window. No failed-stage fallback or downstream engine ran.

The new diagnostic deliberately requests a cross-cell distortion on a simulator, which Tessa's metadata documents as unsupported. A quick domain error would indicate that the validation path responds; the repeated generic timeout instead shows that the documented error did not surface. Combined with the one-shot floor, current configuration failure and successful free control, this adds evidence of a problem in Tessa's handler/dispatch path. It does not prove where validation occurs or identify the remote worker's internal fault. No supported configuration change was established as a repair.

Fresh direct `GET /jobs/{id}/status` requests independently confirm all three Tessa jobs as **failed** with `error.type:"engine_timeout"`, HTTP 200. The documented job-detail endpoint exposes status and timestamps, but no worker logs. The control engine was initially rejected by the app proxy's intentional eight-engine allowlist; that local 403 created no Moth job. The successful free control then used the direct server transport.

Evidence and exact request bodies: [`moth/tessa-retest-2026-10-14.json`](moth/tessa-retest-2026-10-14.json). Moth should inspect these new job IDs for the handler activation, dispatch or response deadline around 60 seconds against the advertised 18,000-second run policy. Credentials and general Atlas job execution were verified; Tessa remains unavailable for the requests tested today.

The existing diagnostic script now supports `--only LABEL` and `--direct`:

```sh
node --env-file=.env.local --import tsx scripts/qa/tessa-variants.ts --only palette-floor-2-1 --direct --live
node --env-file=.env.local --import tsx scripts/qa/tessa-variants.ts --only simulator-distortion-control --direct --live
node --env-file=.env.local --import tsx scripts/qa/tessa-variants.ts --only standard-16-128 --live
```

Each command has a one-submission cap and does not launch confirmation runs. Omit `--live` for offline validation. The default six-case sweep is preserved. TypeScript, diagnostic lint, offline CLI checks (including rejection of unknown labels before live calls) and independent review pass. Only tooling/documentation changed; all eight engines remain required. The local server is open at `http://localhost:3002/`.
