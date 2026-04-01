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
- Convex proxied internally at `https://mangarr.hmphin.space/convex`

The container expects:

- `3737` exposed for the web app and internal Convex proxy

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
