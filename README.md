# Mangarr

Mangarr is a self-hosted manga library manager with a FastAPI backend, a Svelte web client, and a JVM bridge for Tachiyomi-compatible sources.

## Stack

- `server/`: FastAPI, SQLModel, Alembic, background jobs
- `web/`: SvelteKit, TypeScript, Tailwind CSS
- `bridge/`: Kotlin/JVM bridge for extension loading and source access

## Local development

The primary task runner is [`just`](https://github.com/casey/just).

```bash
just install
just dev-server
just dev-web
```

Useful commands:

```bash
just android-stubs
just bridge
just generate-stubs
just generate-types
just test
pnpm --dir web check:all
```

Containerized development:

```bash
just dev-docker
```

This starts the backend on `http://localhost:3737` and web dev server on `http://localhost:3000`.

## Runtime

- Backend: `http://localhost:3737`
- Web: `http://localhost:3000`

Data and mutable configuration live under `config/` and `data/`.

## Credits

Many ideas and parts of the groundwork were adapted from [Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server), which is the successor to [TachiWeb-Server](https://github.com/Tachiweb/TachiWeb-server).

The AndroidCompat module was originally developed by [@null-dev](https://github.com/null-dev) for TachiWeb-Server and is licensed under Apache License 2.0.

Parts of [Mihon](https://github.com/mihonapp/mihon) are also adopted into this codebase and remain under Apache License 2.0.

## Disclaimer

This project is not affiliated with the content providers exposed through installed extensions.
