# Development

## Local Stack

Start the full development stack:

```bash
docker compose -f compose.dev.yaml up --build
```

It starts:

- web app on `http://localhost:3737`
- Convex on `http://localhost:3210`
- Convex dashboard on `http://localhost:6791`

## Common Commands

The main entry points are in [/Users/wnbe/Lab/mangarr/Justfile](/Users/wnbe/Lab/mangarr/Justfile):

```bash
just dev-docker
just dev-web
just convex-push
just lint
just check
just build
just verify-runtime
```

## Notes

- the dev container starts Convex locally, syncs schema/functions, then starts the bridge and web app
- `config/` stores bridge state and Convex runtime state
- `data/` stores downloaded chapters
- `just convex-push` is the manual re-sync path once the stack is already running
