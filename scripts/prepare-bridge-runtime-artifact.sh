#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_TAR="${1:?usage: prepare-bridge-runtime-artifact.sh <output-tar.gz>}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

mkdir -p "${TMP_DIR}/app/bin"

JAR_PATH="$(find "${ROOT_DIR}/bridge/app/build" -maxdepth 1 -type f -name 'tachibridge-*.jar' | head -n1)"
if [ -z "${JAR_PATH}" ]; then
	echo "tachibridge shadowJar not found under bridge/app/build" >&2
	exit 1
fi

cp "${JAR_PATH}" "${TMP_DIR}/app/bin/tachibridge.jar"

mkdir -p "$(dirname "${OUTPUT_TAR}")"
tar -C "${TMP_DIR}" -czf "${OUTPUT_TAR}" app
