#!/usr/bin/env bash
set -euo pipefail

cd /workspaces/mangarr

corepack enable
uv python install 3.13
just install

mkdir -p config/bin data

echo "Devcontainer bootstrap complete."
echo "Use 'just dev-server' and 'just dev-web' to start the app."
