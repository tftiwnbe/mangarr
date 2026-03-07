set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

server_port := `cd server && uv run python -c "from app.config import settings; print(settings.server.port)"`
static_dir := "server/app/static"

default:
    @just --list

[doc("Show available commands")]
help:
    @just --list

[doc("Start production stack with Docker Compose")]
docker:
    @echo "Starting docker compose stack..."
    docker compose up --build

[doc("Refresh Android compatibility stubs")]
android-stubs:
    @echo "Refreshing android-stubs..."
    ./bridge/AndroidCompat/getAndroid.sh

[doc("Build tachibridge jar")]
bridge:
    @echo "Building tachibridge jar..."
    if [ ! -f "bridge/app/lib/android.jar" ]; then echo "android.jar not found, fetching..."; ./bridge/AndroidCompat/getAndroid.sh; fi
    cd bridge && ./gradlew clean shadowJar
    mkdir -p config/bin
    mv -f bridge/app/build/*.jar config/bin/
    echo "Tachibridge jar built successfully."

[doc("Install development dependencies")]
install:
    @echo "Installing development dependencies..."
    cd server && uv sync --group dev
    cd web && pnpm install

[doc("Generate Python gRPC stubs")]
generate-stubs:
    @echo "Generating stubs..."
    cd server && uv run -m grpc_tools.protoc \
      --proto_path ../bridge/app/src/main/proto \
      --python_out=./app/bridge/proto \
      --pyi_out=./app/bridge/proto \
      --grpc_python_out=./app/bridge/proto \
      mangarr/tachibridge/tachibridge.proto \
      mangarr/tachibridge/extensions/extensions.proto \
      mangarr/tachibridge/config/config.proto
    cd server && uv run python -c "from pathlib import Path; files=(Path('app/bridge/proto/mangarr/tachibridge/tachibridge_pb2.py'), Path('app/bridge/proto/mangarr/tachibridge/tachibridge_pb2_grpc.py')); replacements=(('from mangarr.tachibridge.config import config_pb2 as','from .config import config_pb2 as'), ('from mangarr.tachibridge.extensions import extensions_pb2 as','from .extensions import extensions_pb2 as'), ('from mangarr.tachibridge import tachibridge_pb2 as','from . import tachibridge_pb2 as')); [file.write_text((lambda text: [text := text.replace(src, dst) for src, dst in replacements] and text)(file.read_text())) for file in files]"

[doc("Generate TypeScript API types from the running backend")]
generate-types:
    @echo "Checking if backend is running..."
    if ! nc -z localhost {{server_port}}; then echo "Backend not running on port {{server_port}}"; exit 1; fi
    @echo "Generating types for endpoints..."
    cd web && pnpm run generate:api

[doc("Start FastAPI in dev mode")]
dev-server:
    @echo "Starting fastapi in dev mode..."
    cd server && uv run fastapi dev --host 0.0.0.0 --port {{server_port}}

[doc("Start Vite dev server")]
dev-web:
    @echo "Starting vite dev server..."
    cd web && pnpm run dev --open

[doc("Start container stack for development")]
dev-docker:
    @echo "Starting docker compose dev stack..."
    docker compose -f compose.dev.yaml up --build

[doc("Build web, then start the server")]
run:
    @echo "Building web..."
    cd web && pnpm run build
    @echo "Starting uvicorn..."
    cd server && uv run python -m app.main

[doc("Run the server test suite")]
test:
    @echo "Testing fastapi application..."
    cd server && uv run --group dev pytest

[doc("Run Ruff diagnostics on the server")]
lint-server:
    @echo "Linting fastapi application..."
    cd server && uv run --group dev ruff check .

[doc("Run ESLint and Prettier checks for the web client")]
lint-web:
    @echo "Linting web client..."
    cd web && pnpm run lint

[doc("Run all linting tasks")]
lint: lint-server lint-web

[doc("Apply Ruff formatting to the server")]
format-server:
    @echo "Formatting fastapi application..."
    cd server && uv run --group dev ruff format .

[doc("Apply Prettier formatting to the web client")]
format-web:
    @echo "Formatting web client..."
    cd web && pnpm run format

[doc("Run all formatting tasks")]
format: format-server format-web

[doc("Audit Python dependencies for known vulnerabilities")]
audit-server:
    @echo "Auditing Python dependencies..."
    cd server && uv run pip-audit

[doc("Audit Node dependencies for known vulnerabilities")]
audit-web:
    @echo "Auditing Node dependencies..."
    cd web && pnpm audit --prod

[doc("Run all dependency audits")]
audit: audit-server audit-web

[doc("Remove local build and runtime artifacts")]
clean:
    @echo "Removing runtime files..."
    find . -name ".venv" -type d -prune -exec rm -rf {} +
    find . -name "node_modules" -type d -prune -exec rm -rf {} +
    find . -name "dist" -type d -prune -exec rm -rf '{}' +
    find . -name "build" -type d -prune -exec rm -rf '{}' +
    find . -name ".svelte-kit" -type d -prune -exec rm -rf '{}' +
    find . -name "coverage" -type d -prune -exec rm -rf '{}' +
    find . -name ".pnpm-store" -type d -prune -exec rm -rf '{}' +
    find . -name ".gradle" -type d -prune -exec rm -rf '{}' +
    if [ -d "{{static_dir}}" ]; then echo "Removing generated static files in {{static_dir}}"; rm -rf {{static_dir}}/*; fi
