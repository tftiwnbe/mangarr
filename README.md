# Mangarr

Mangarr is a self-hosted manga manager built around a SvelteKit web app, a self-hosted Convex backend, and a Kotlin bridge that handles source access, downloads, and reader-side file serving.

## What It Does

- browse and search Tachiyomi-compatible sources
- import titles into a local library with statuses, collections, and progress
- download chapters and read them in the browser
- manage extensions, source preferences, proxy settings, and integration keys

## Screenshots

![First admin setup](/Users/wnbe/Lab/mangarr/docs/screenshots/first-admin.png)

![Setup wizard](/Users/wnbe/Lab/mangarr/docs/screenshots/setup-wizard.png)

## Quick Start

Development:

```bash
docker compose -f compose.dev.yaml up --build
```

Production example:

```bash
docker compose up -d
```

Images:

- `ghcr.io/tftiwnbe/mangarr:edge`
- `ghcr.io/tftiwnbe/mangarr:latest`

## Docs

- [Deploy](/Users/wnbe/Lab/mangarr/docs/deploy.md)
- [Development](/Users/wnbe/Lab/mangarr/docs/development.md)
- [Integration API](/Users/wnbe/Lab/mangarr/docs/integration-api.md)

## Project Layout

- `web/` SvelteKit app plus Convex functions
- `bridge/` Kotlin/JVM bridge runtime
- `config/` persisted runtime state, extensions, auth material, and logs
- `data/` downloaded chapter files

## Credits

Mangarr builds on ideas and implementation work from the Tachiyomi ecosystem.

- [Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server)
- [Mihon](https://github.com/mihonapp/mihon)
- `AndroidCompat` from the TachiWeb-Server line by [@null-dev](https://github.com/null-dev)

## License

Mangarr is licensed under the GNU Affero General Public License v3.0. See [LICENSE](/Users/wnbe/Lab/mangarr/LICENSE).
