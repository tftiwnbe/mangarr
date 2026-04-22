# Deploy

## Compose

The production example in [compose.yaml](../compose.yaml) is intentionally simple:

- published image only
- fixed `linux/amd64` runtime platform
- `./config:/app/config`
- `./data:/app/downloads`
- one required public URL setting

Bring it up with:

```bash
docker compose up -d
```

To build the runtime locally from the checked-out repo instead of pulling `ghcr.io`, use the repo override:

```bash
MANGARR_HOST_CONFIG_DIR=./config \
MANGARR_HOST_DOWNLOADS_DIR=./data \
docker compose -f compose.yaml -f compose.repo.yaml up -d --build
```

That keeps the production runtime target and lets you point persistence at any host directories without editing tracked compose files.

Default example values:

- web app on `https://mangarr.hmphin.space`
- Convex proxied internally at `https://mangarr.hmphin.space/convex`

The container expects:

- `3737` exposed for the web app and internal Convex proxy

## Architecture Note

The shipped compose examples pin Mangarr to `linux/amd64`.

That is intentional. Current upstream CEF/JCEF loading on Linux `arm64` is not reliable enough for the embedded KCEF runtime, so the supported container path for bridge + KCEF is the `amd64` image, even on arm64 hosts via Docker emulation.

## Persistent Data

Back up:

- `config/`
- `data/`

`config/` contains:

- Convex instance state
- bridge state and installed extensions
- generated signing secrets and auth JWK
- logs under `config/logs/`

`data/` contains:

- downloaded chapter files under `/app/downloads`

## Runtime Notes

- the runtime generates a per-instance Convex JWT signing key inside `config/convex/` on first boot
- logs are written to `config/logs/system/` and `config/logs/bridge/`
- the public web URL is configured with `MANGARR_PUBLIC_URL`
- the public Convex URL is derived automatically as `${MANGARR_PUBLIC_URL}/convex`

## Restore

To restore an instance:

```bash
docker compose down
docker compose up -d
```

Restore both persisted directories first:

- `config/`
- `data/`

## Verification

For a clean production-like local smoke pass:

```bash
just verify-prod
```

That command uses fresh temporary `config/` and `downloads/` directories, builds the runtime image locally, waits for the login page, prints container status, and tears the stack down again.

## Image Channels

Published images:

- `ghcr.io/tftiwnbe/mangarr:edge`
- `ghcr.io/tftiwnbe/mangarr:latest`

Both published channels currently target `linux/amd64`.
