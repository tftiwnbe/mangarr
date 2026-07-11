# Reliability and performance follow-up

## Context

Production on `toaster02` is currently healthy (no restarts or OOM kills since the last deployment), but the last 72 hours show recurring, actionable application faults:

- 26 Convex optimistic-concurrency conflicts on `downloadProfiles`; the `chapter sync for monitored titles` cron failed and was retried.
- Convex repeatedly restarted isolates for `library.js:listMine` with 46–64 MiB memory carry-over, and once for `runtime_commands.js:leaseBatch`.
- A command targeting an uninstalled source retried three times at five-second intervals before failing.

The work below addresses the first two items and makes the third failure terminal immediately. Do not change product behavior, command priorities, or schema semantics beyond the indexes needed for efficient scoped reads.

## Codex implementation prompt

```text
Improve Mangarr's Convex/bridge reliability and scalability. Work in the existing patterns and preserve current API return shapes unless a compatible additive change is unavoidable.

Production evidence (toaster02, 2026-07-11):
- The `chapter sync for monitored titles` cron repeatedly fails with Convex OCC errors: `Documents read from or written to the "downloadProfiles" table changed while this mutation was being run and on every subsequent retry` (26 occurrences in 72 hours).
- Convex repeatedly restarts isolates with `TooMuchMemoryCarryOver` after `library.js:listMine` (46–64 MiB). The library page subscribes to this query reactively.
- Commands for missing source `6338219619148105941` retried three times (5-second delay) even though the bridge immediately knows the source is absent.

Implement all of the following.

1. Make scheduled chapter-sync selection OCC-resistant.
   - Inspect `web/src/convex/library_downloads.ts`, especially `runScheduledChapterSync`, and all mutations that patch `downloadProfiles`.
   - Avoid a single long mutation that reads every enabled profile and then does per-title work while other mutations update those profiles. Use indexed, bounded candidate reads and/or split selection from command insertion so normal profile updates do not invalidate the entire cron transaction.
   - Preserve fairness: select up to `maxTitles` non-paused, enabled profiles with the oldest effective chapter-sync cursor that are past `CHAPTER_SYNC_COOLDOWN_MS`.
   - Prevent duplicate active `library.chapters.sync` commands for the same owner/title/source/url under concurrent scheduler invocations.
   - Add the smallest useful structured observability for scheduler contention/selection, without logging sensitive data.

2. Bound and scope `library.listMine`.
   - Inspect `web/src/convex/library_reader_queries.ts:listMine` and the library-page caller.
   - Eliminate global table scans: it currently calls `ctx.db.query('titleVariants').collect()` and filters by owner in memory. Read only the viewer's variants using an appropriate owner-prefixed index. Keep installed-extension lookup efficient and avoid rebuilding unnecessarily large maps.
   - Do not fetch 5,000–10,000 complete title records merely because the UI initially renders 60. Introduce compatible bounded/paginated loading or another approach that keeps filtering/sorting UX correct while bounding Convex read volume and subscription payloads.
   - Ensure the page remains reactive and preserves search, collection, source, status, genre, and sort behavior. If true server-side filtering is needed to make that possible, design an explicit query contract rather than silently truncating results.
   - Add indexes only where they directly support the new bounded/scoped access pattern.

3. Classify missing bridge sources as terminal failures.
   - In `bridge/app/src/main/kotlin/mangarr/tachibridge/runtime/SourceFailureClassifier.kt`, recognize the bridge's known missing-source exceptions (`Source not found: …` and `Source … not found or wrong type`) as expected, non-retryable failures.
   - Ensure this covers nested causes and does not turn genuine transient network failures terminal.

Verification requirements:
- Add focused automated tests for missing-source classification, scheduler duplicate/concurrency behavior (or deterministic helpers that make it testable), and scoped/bounded library-query behavior.
- Run `pnpm test:unit`, `pnpm lint` (format only files you touch; do not reformat unrelated existing files), and `./gradlew --no-daemon test` from `bridge`.
- Report the before/after query and mutation access patterns, compatibility considerations, and any deployment/migration action required.
```

## Deferred observation

The bridge also emitted 17 OkHttp warnings in 72 hours about a leaked response for `https://hapi.hentaicdn.org/`. The warning is emitted from an extension execution path and the current log level does not include allocation traces, so do not make speculative cleanup changes. In a separate diagnostic task, temporarily enable the targeted OkHttp allocation trace, reproduce one request, and fix the exact owner of the unclosed response.
