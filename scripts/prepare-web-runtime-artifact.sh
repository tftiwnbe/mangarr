#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_TAR="${1:?usage: prepare-web-runtime-artifact.sh <output-tar.gz>}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

RUNTIME_ROOT="${TMP_DIR}/app/web"
mkdir -p "${RUNTIME_ROOT}/src/lib/server" "${RUNTIME_ROOT}/src/lib" "${RUNTIME_ROOT}/.svelte-kit"

cp "${ROOT_DIR}/web/package.json" "${RUNTIME_ROOT}/package.json"
cp "${ROOT_DIR}/web/pnpm-lock.yaml" "${RUNTIME_ROOT}/pnpm-lock.yaml"
cp "${ROOT_DIR}/web/pnpm-workspace.yaml" "${RUNTIME_ROOT}/pnpm-workspace.yaml"
cp "${ROOT_DIR}/web/convex.json" "${RUNTIME_ROOT}/convex.json"
cp "${ROOT_DIR}/web/server.js" "${RUNTIME_ROOT}/server.js"
cp "${ROOT_DIR}/web/tsconfig.json" "${RUNTIME_ROOT}/tsconfig.json"
cp "${ROOT_DIR}/web/.svelte-kit/tsconfig.json" "${RUNTIME_ROOT}/.svelte-kit/tsconfig.json"
cp -R "${ROOT_DIR}/web/build" "${RUNTIME_ROOT}/build"
cp -R "${ROOT_DIR}/web/src/convex" "${RUNTIME_ROOT}/src/convex"
cp -R "${ROOT_DIR}/web/src/lib/utils" "${RUNTIME_ROOT}/src/lib/utils"
cp "${ROOT_DIR}/web/src/lib/server/convex-auth-config.ts" "${RUNTIME_ROOT}/src/lib/server/convex-auth-config.ts"

(
	cd "${RUNTIME_ROOT}"
	pnpm install --frozen-lockfile --prod --prefer-offline
)

mkdir -p "$(dirname "${OUTPUT_TAR}")"
tar -C "${TMP_DIR}" -czf "${OUTPUT_TAR}" app
