# Mangarr web

The SvelteKit frontend and Convex functions run together in the Mangarr runtime.

For the full local stack (web, Convex, bridge, and PostgreSQL), run this from the repository root:

```sh
docker compose -f compose.dev.yaml up --build
```

For frontend-only work:

```sh
pnpm install
pnpm run dev
```

Use `pnpm run lint`, `pnpm run check`, and `pnpm run test:unit -- --run` before submitting web changes. See [the root development guide](../docs/development.md) for runtime commands and troubleshooting.
