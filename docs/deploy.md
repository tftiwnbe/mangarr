# Deploy

## Compose

The production example in [/Users/wnbe/Lab/mangarr/compose.yaml](/Users/wnbe/Lab/mangarr/compose.yaml) is intentionally simple:

- published image only
- `./config:/app/config`
- `./data:/app/downloads`
- one required public URL setting

Bring it up with:

```bash
docker compose up -d
```

Default example values:

- web app on `https://mangarr.hmphin.space`
- Convex on the same host, derived automatically on port `3210`

The container expects:

- `3737` exposed for the web app
- `3210` exposed for the self-hosted Convex endpoint used by the browser client

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
- the public Convex URL is derived automatically from that same host on port `3210`

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
