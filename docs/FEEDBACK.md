# User feedback follow-up — 2026-10-11

This pass reduces render and audio work, makes touches and artifact positions easier to inspect, varies membrane
parameters across genome and tissue inputs, and lets users resume a long-running Echo job without a duplicate submit.
The initially visual key field now has functional Moth verification. The BYOK badge and disconnected-field disclaimer
are removed. **Check key** authenticates with Atlas `/me` without running an engine; Accepted means the checked key
will be used for Create/Evolve. Editing resets acceptance, unchecked keys block a new run, and Clear restores the app
key. Visitor credentials stay only in browser memory and survive panel switching, but not reload. They are never
persisted in storage, cookies, logs, or specimens. Each run captures its key; pending-job Resume requires the original
credential. Cached skin is uploaded into the selected account when changing credential scopes.

The canvas uses a 160×100 sphere, DPR up to 1.5, MSAA 2, a 30 fps specimen / 15 fps blank schedule, and pauses while
the document is hidden. Muted audio suspends its graph; visual samples run at 20 Hz and a four-entry PCM cache bounds
retained audio data. Echo gets a 20-minute initial polling budget. Stop/Resume preserves the same job id in memory; it
does not survive a page reload. These are resource controls and local recovery behavior, not universal device
benchmarks or external Atlas latency guarantees.

**QA is complete.** Production build, final TypeScript/lint, 363 surface checks, 98 mask checks, membrane parameter
sweep, Echo recovery regressions, and the Apple GPU temporal check pass. The feedback browser QA passes key controls,
Pulse without a wound, queued-touch Resume Evolve, DPR/FPS behavior, hidden pause/resume, and PNG capture. Recovery
requests are mocked GETs with zero paid submissions. Temporal coverage is 15 states / 2,700 samples (minimum brightness 71.31, lit ratio .993, zero errors); the
previous Echo renderer fails the halo negative control at 91.99 against a 55 limit. The initial transparent-canvas
warning was a WebKit QA false positive from an early `getContext` probe; compositor screenshot and A/B evidence
confirmed the canvas was visible, and the probe was removed.

An earlier free browser journey scored 50/51 because a dev RSC request was interrupted during source edits. The stable
rerun passes 51/51 with zero unexpected errors, failed requests, or Atlas calls; evidence is in
`/private/tmp/chrono-feedback-stable-e2e`. The key follow-up adds `scripts/verify-moth-key.ts` and `scripts/qa/key.mjs`,
covering verification states, no persistence, credential forwarding, stale responses, archive uploads, and uncached
downloads across keys. Live read-only checks through the local route confirm 200/Accepted for the configured key,
401 for an invalid dummy, and 400 for no key without falling back. Responses contain no identity or credential.
The manual browser confirms Rejected and Clear → Using app key. No paid Atlas jobs or credits were used by agent QA. Changes are local at
`http://localhost:3002`; they have not been pushed or published. See `status.md` for the handover state.
