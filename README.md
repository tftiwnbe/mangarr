# Mangarr

Mangarr is a self-hosted manga manager for people who want one place to discover series, build a personal library, monitor downloads, and read through a browser without depending on a hosted service.

It combines a FastAPI backend, a Svelte web client, and a JVM bridge that loads Tachiyomi-compatible extensions. The goal is practical: keep the parts that make source-driven manga management powerful, but package them into a cleaner server-first workflow you can run yourself.

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

- `server/` FastAPI application, SQLModel models, Alembic migrations, jobs, and API routes
- `web/` SvelteKit frontend
- `bridge/` Kotlin/JVM bridge for extension loading and source access

## Getting Started

Prerequisites:

- Python with `uv`
- Node.js with `pnpm`
- Java for the bridge build

Install dependencies and build the bridge once:

```bash
just install
just bridge
```

Run the app:

```bash
just run
```

Default URLs:

- App/API: `http://localhost:3737`
- Web dev server: `http://localhost:3000`

Mutable state lives under `config/` and `data/`.

## Development Workflow

Common commands are grouped in the `Justfile`:

```bash
just format
just lint
just check-all
just build
just release
```

Development servers:

```bash
just dev-server
just dev-web
just dev-docker
```

Other useful tasks:

```bash
just generate-stubs
just generate-types
just smoke
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
