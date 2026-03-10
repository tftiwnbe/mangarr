# Mangarr

Mangarr is a self-hosted manga manager for people who want one place to discover series, build a personal library, monitor downloads, and read through a browser without depending on a hosted service.

The current `v2.0.0-alpha` branch is being rebuilt around a SvelteKit web app, a self-hosted Convex backend, and a Node worker that owns bridge and filesystem side effects. The goal is practical: keep the parts that make source-driven manga management powerful, but package them into a cleaner single-stack workflow you can run yourself.

## What It Does

- Bootstraps a fresh instance with a first-admin flow and guided setup.
- Connects to Tachiyomi-compatible extension repositories through the bridge layer.
- Lets you browse popular, latest, category, and search feeds across sources.
- Imports titles into a local library with collections, statuses, preferred variants, and reading progress.
- Tracks watched titles and download activity, including reconciliation for external titles.
- Provides a browser reader plus account, scheduler, proxy, download, and integration-key settings.

## Screenshots

Fresh-install screens from a local `v2.0.0` build:

![First admin setup](docs/screenshots/first-admin.png)

![Setup wizard](docs/screenshots/setup-wizard.png)

## Project Layout

- `web/` active SvelteKit v2 app plus Convex functions under `web/src/convex/`
- `worker/` Fastify-based worker for bridge supervision and host-side effects
- `bridge/` Kotlin/JVM bridge for extension loading and source access
- `web-ref/` local frontend reference from the archived FastAPI prototype
- `server-ref/` local backend reference from the archived FastAPI prototype

## Getting Started

Prerequisites:

 - Node.js with `pnpm`
 - Docker with Compose

Bring up the local v2 stack:

```bash
docker compose -f compose.dev.yaml up --build
```

The Compose stack starts:

- `web` on `http://localhost:3737`
- self-hosted Convex backend on `http://127.0.0.1:3210`
- Convex site proxy on `http://127.0.0.1:3211`
- Convex dashboard on `http://localhost:6791`
- `worker` health endpoint on `http://127.0.0.1:3212/health`

The dev compose file pins a deterministic self-hosted Convex admin key so the CLI can talk to the local backend without a separate setup step:

```bash
export CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
export CONVEX_SELF_HOSTED_ADMIN_KEY='mangarr-dev|017d2981db031fce1d83c074abf4c2cf7a51bce8874e23b9964936b367eac682d6b7097b86'
```

Telemetry is disabled for the self-hosted Convex backend in both compose files via `DISABLE_BEACON=true`.

Default URLs:

- Web UI: `http://localhost:3737`
- Convex backend: `http://127.0.0.1:3210`
- Convex dashboard: `http://localhost:6791`

Bridge and worker artifacts live under `config/` and `data/`. Convex persists its local self-hosted state in the Docker-managed `convex_data` volume by default.

## Development Workflow

Common commands are grouped in the `Justfile`:

```bash
just lint
just check
just build
just release
```

Development servers:

```bash
just dev-docker
just dev-web
just dev-worker
just dev-convex
```

Other useful tasks:

```bash
just smoke
just bridge
just clean
```

## Credits

Mangarr builds on ideas and implementation work from the Tachiyomi ecosystem.

- [Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server) and the earlier TachiWeb-Server line influenced the server-side foundation and extension-oriented workflow.
- The `AndroidCompat` module was originally developed by [@null-dev](https://github.com/null-dev) for TachiWeb-Server.
- Parts of [Mihon](https://github.com/mihonapp/mihon) are adapted in this codebase where appropriate.

Please keep the original upstream licenses and attribution in mind when reusing or redistributing derivative work.

## License

Mangarr is licensed under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE).

Some embedded or adapted components retain their own upstream licensing terms, including Apache License 2.0 for parts of the Android/Tachiyomi-derived stack.

## Disclaimer

Mangarr is an independent self-hosted project. It is not affiliated with, endorsed by, or supported by manga publishers, scanlation groups, source websites, Tachiyomi, Mihon, or extension maintainers.

You are responsible for how you use the software, which repositories you add, and whether your usage complies with local law, source terms, and copyright rules in your jurisdiction.
