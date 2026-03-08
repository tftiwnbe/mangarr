set shell := ["bash", "-eu", "-o", "pipefail", "-c"]
set unstable := true

server_port := `cd server && uv run python -c "from app.config import settings; print(settings.server.port)"`
web_port := "3000"
static_dir := "server/app/static"

# Show available commands
[group('meta')]
default:
    @just --unstable --list

# Show available commands
[group('meta')]
help:
    @just --unstable --list

# Install development dependencies
[group('setup')]
install:
    @echo "Installing development dependencies..."
    cd server && uv sync --group dev
    cd web && pnpm install

# Refresh Android compatibility stubs
[group('generate')]
android-stubs:
    @echo "Refreshing android-stubs..."
    ./bridge/AndroidCompat/getAndroid.sh

# Generate Python gRPC stubs
[group('generate')]
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

# Generate TypeScript API types from the running backend
[group('generate')]
generate-types:
    @echo "Checking if backend is running..."
    if ! nc -z localhost {{ server_port }}; then echo "Backend not running on port {{ server_port }}"; exit 1; fi
    @echo "Generating types for endpoints..."
    cd web && pnpm run generate:api

# Start FastAPI in dev mode
[group('dev')]
dev-server:
    @echo "Starting fastapi in dev mode..."
    cd server && uv run fastapi dev --host 0.0.0.0 --port {{ server_port }}

# Start Vite dev server
[group('dev')]
dev-web:
    @echo "Starting vite dev server..."
    cd web && pnpm run dev --open

# Start container stack for development
[group('dev')]
dev-docker:
    @echo "Starting docker compose dev stack..."
    docker compose -f compose.dev.yaml up --build --remove-orphans

# Stop container stack for development
[group('dev')]
dev-docker-down:
    @echo "Stopping docker compose dev stack..."
    docker compose -f compose.dev.yaml down --remove-orphans

# Start production stack with Docker Compose
[group('runtime')]
docker:
    @echo "Starting docker compose stack..."
    docker compose up --build

# Build web, then start the server
[group('runtime')]
run:
    @echo "Building web..."
    cd web && pnpm run build
    @echo "Starting uvicorn..."
    cd server && uv run python -m app.main

# Build the bridge jar and copy it to the local runtime directory
[group('build')]
build-bridge:
    @echo "Building bridge jar..."
    if [ ! -f "bridge/app/lib/android.jar" ]; then echo "android.jar not found, fetching..."; ./bridge/AndroidCompat/getAndroid.sh; fi
    cd bridge && ./gradlew shadowJar
    mkdir -p config/bin
    cp -f bridge/app/build/*.jar config/bin/

# Build tachibridge jar
[group('build')]
bridge:
    @just build-bridge

# Byte-compile the server
[group('build')]
build-server:
    @echo "Building fastapi application..."
    cd server && uv run python -m compileall app

# Build the web client
[group('build')]
build-web:
    @echo "Building web client..."
    cd web && pnpm run build

# Build all major project artifacts
[group('build')]
build: build-server build-web build-bridge

# Apply Ruff formatting to the server
[group('quality')]
format-server:
    @echo "Formatting fastapi application..."
    cd server && uv run --group dev ruff format .

# Apply Prettier formatting to the web client
[group('quality')]
format-web:
    @echo "Formatting web client..."
    cd web && pnpm run format

# Apply ktlint formatting to the bridge
[group('quality')]
format-bridge:
    @echo "Formatting bridge sources..."
    cd bridge && ./gradlew ktlintFormat

# Run all formatting tasks
[group('quality')]
format: format-server format-web format-bridge

# Run the server test suite
[group('quality')]
test:
    @echo "Testing fastapi application..."
    cd server && if rg --files -g 'test_*.py' -g '*_test.py' >/dev/null; then uv run --group dev pytest; else echo "No server tests found; skipping pytest."; fi

# Run Ruff diagnostics on the server
[group('quality')]
lint-server:
    @echo "Linting fastapi application..."
    cd server && uv run --group dev ruff check .

# Run ESLint and Prettier checks for the web client
[group('quality')]
lint-web:
    @echo "Linting web client..."
    cd web && pnpm run lint

# Run ktlint checks for the bridge
[group('quality')]
lint-bridge:
    @echo "Linting bridge sources..."
    cd bridge && ./gradlew ktlintCheck

# Run all linting tasks
[group('quality')]
lint: lint-server lint-web lint-bridge

# Run server static checks (lint + tests)
[group('quality')]
check-server:
    @echo "Running server checks..."
    cd server && uv run --group dev ruff check .
    cd server && if rg --files -g 'test_*.py' -g '*_test.py' >/dev/null; then uv run --group dev pytest; else echo "No server tests found; skipping pytest."; fi

# Run web static checks
[group('quality')]
check-web:
    @echo "Running web checks..."
    cd web && pnpm run check:all

# Compile and verify bridge sources
[group('quality')]
check-bridge:
    @echo "Running bridge checks..."
    cd bridge && ./gradlew build

# Run all major project checks
[group('quality')]
check-all: check-server check-web check-bridge

# Smoke-test running server/web endpoints
[group('quality')]
smoke:
    @echo "Running smoke checks..."
    curl -fsS "http://127.0.0.1:{{ server_port }}/api/v2/health" >/dev/null
    curl -fsS "http://127.0.0.1:{{ web_port }}" >/dev/null
    echo "Smoke checks passed."

# Audit Python dependencies for known vulnerabilities
[group('quality')]
audit-server:
    @echo "Auditing Python dependencies..."
    cd server && uv run pip-audit

# Audit Node dependencies for known vulnerabilities
[group('quality')]
audit-web:
    @echo "Auditing Node dependencies..."
    cd web && pnpm audit --prod

# Run all dependency audits
[group('quality')]
audit: audit-server audit-web

# Release readiness pass: format, lint, check, build
[group('quality')]
release: format lint check-all build

# Remove local build and runtime artifacts
[group('maintenance')]
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
    if [ -d "{{ static_dir }}" ]; then echo "Removing generated static files in {{ static_dir }}"; rm -rf {{ static_dir }}/*; fi
