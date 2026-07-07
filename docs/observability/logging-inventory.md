# Logging Inventory

Verified against repository state on 2026-07-02.

## Runtime inventory

- `Dockerfile` builds a single runtime container that now starts Convex, the Kotlin bridge, and the web server from the checked-in Node supervisor at `scripts/runtime-supervisor.mjs`.
- PostgreSQL is external to that container and referenced through `CONVEX_POSTGRES_URL`.
- The previous generated shell startup script handled process startup, readiness checks, secret generation, file log creation, file rotation, `tee` duplication, component prefixing, noise filtering, and shutdown.
- The current supervisor now owns process startup, readiness checks, secret generation, Convex runtime sync, KCEF runtime wiring, structured log normalization, and shutdown.
- The previous shell startup script emitted duplicate live logs by writing component output to stdout or stderr and to rotated files at the same time.

## Web inventory

- `web/src/lib/server/logging.js` previously wrote structured JSON to `web-events.jsonl` and separately rendered human-readable console lines for the same event.
- `web/src/lib/server/observability.ts` generates or accepts `x-request-id`, classifies request kind, suppresses routine probe success logs, and logs slow or failing requests.
- `web/src/hooks.server.ts` installs request ID and request completion or failure logging for SvelteKit requests.
- `web/server.js` logs Convex proxy HTTP completions, upgrade failures, and server startup using the same web logging helper.
- Remaining direct console usage in web code exists in Convex functions and maintenance paths:
  - `web/src/convex/bridge_workpool.ts`
  - `web/src/convex/commands.ts`
  - `web/src/convex/maintenance.ts`
  - `web/src/routes/api/internal/bridge/library/cover/+server.ts`

## Bridge inventory

- `bridge/app/src/main/resources/logback.xml` previously configured both a human-readable console appender and a JSON rolling-file appender.
- `bridge/app/src/main/kotlin/mangarr/tachibridge/logging/EventLogger.kt` previously wrote event fields through SLF4J MDC after converting all values with `toString()`, which flattened numbers and booleans into strings before JSON encoding.
- Structured event logging is already used in:
  - `bridge/app/src/main/kotlin/mangarr/tachibridge/server/BridgeServer.kt`
  - `bridge/app/src/main/kotlin/mangarr/tachibridge/server/BridgeHttpServer.kt`
  - `bridge/app/src/main/kotlin/mangarr/tachibridge/runtime/BridgeCommandRunner.kt`
  - `bridge/app/src/main/kotlin/mangarr/tachibridge/runtime/BridgeHeartbeatReporter.kt`
- Raw `KotlinLogging` usage still exists in several bridge areas, including:
  - `BridgeService.kt`
  - `BridgeServiceCacheSupport.kt`
  - `BridgeHttpServer.kt`
  - `ExtensionManager.kt`
  - `ExtensionRepoService.kt`
  - `InstalledExtensionStore.kt`
  - loader and network support classes
- Koin logging is routed through SLF4J in `KoinSlf4jLogger.kt`.

## Supervisor and process-routing inventory

- The previous `Dockerfile` startup layer created these live log files or symlinks:
  - Convex stdout and stderr files
  - setup logs
  - web console logs
  - `web-events.jsonl`
  - bridge console logs
  - bridge native noise logs
- `tee` was used to duplicate Convex, setup, bridge, and web process output to stdout or stderr and to files.
- The previous shell script filtered known Convex and JCEF or DBus noise before forwarding the rest.
- The current supervisor performs that filtering and wraps plain-text child-process output into the canonical JSON event shape before it reaches container stdout or stderr.

## Sensitive-data review

- The previous startup script printed the Convex dev admin key when `MANGARR_APP_MODE=dev`; the current supervisor no longer emits the key value.
- Startup logs include service URLs and readiness events.
- I did not find evidence that request logging intentionally records auth secrets, but some raw warning messages in bridge or Convex paths may include URLs and application identifiers.

## Incorrect or incomplete assumptions from the task brief

- The prompt correctly identified the main duplicate-sink problem, but the web structured logger lives in `web/src/lib/server/logging.js`; `web/src/lib/server/observability.ts` only orchestrates request logging.
- The prompt implied `BridgeService` might be one of a few remaining raw logger users; in practice, raw `KotlinLogging` usage is broader across bridge runtime, extension, repo, loader, and storage paths.
- The prompt described `web/src/lib/server/observability.ts` as likely suppressing ordinary successful requests; that is correct, but the suppression policy also contains path-specific slow thresholds and browser-probe 404 suppression in `web/src/lib/server/logging.js`.
- The prompt focused on Docker log files and `tee`, which is accurate, but the runtime also created symlink aliases for current log files and rotated `web-events.jsonl` separately.

## Restoration target implemented by this change

- One canonical structured JSON event per live line to stdout or stderr.
- No live file sink for the same event from the web server, bridge logger, or runtime supervisor.
- Plain-text child-process output normalized into JSON before it reaches container stdout or stderr.
- Runtime orchestration moved out of an embedded Dockerfile heredoc and into a checked-in supervisor with explicit process and logging ownership.
