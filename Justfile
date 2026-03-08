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

# Build bridge artifacts
[private]
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

# Build server bytecode
[private]
build-server:
    @echo "Building fastapi application..."
    cd server && uv run python -m compileall app

# Build web client
[private]
build-web:
    @echo "Building web client..."
    cd web && pnpm run build

# Build project
[group('build')]
build target="all":
    @case "{{ target }}" in \
      all) \
        echo "Building server, web, and bridge..."; \
        just build server; \
        just build web; \
        just build bridge; \
        ;; \
      server) \
        just build-server; \
        ;; \
      web) \
        just build-web; \
        ;; \
      bridge) \
        just build-bridge; \
        ;; \
      *) \
        echo "Unknown build target: {{ target }} (expected: all|server|web|bridge)"; \
        exit 1; \
        ;; \
    esac

# Format server code
[private]
format-server:
    @echo "Formatting fastapi application..."
    cd server && uv run --group dev ruff format .

# Check server formatting
[private]
format-check-server:
    @echo "Checking fastapi formatting..."
    cd server && uv run --group dev ruff format --check .

# Format web code
[private]
format-web:
    @echo "Formatting web client..."
    cd web && pnpm run format

# Format bridge code
[private]
format-bridge:
    @echo "Formatting bridge sources..."
    cd bridge && ./gradlew ktlintFormat

# Format code
[group('quality')]
format target="all":
    @case "{{ target }}" in \
      all) \
        echo "Formatting server, web, and bridge..."; \
        just format server; \
        just format web; \
        just format bridge; \
        ;; \
      server) \
        just format-server; \
        ;; \
      web) \
        just format-web; \
        ;; \
      bridge) \
        just format-bridge; \
        ;; \
      *) \
        echo "Unknown format target: {{ target }} (expected: all|server|web|bridge)"; \
        exit 1; \
        ;; \
    esac

# Run server tests
[group('quality')]
test:
    @echo "Testing fastapi application..."
    cd server && if rg --files -g 'test_*.py' -g '*_test.py' >/dev/null; then uv run --group dev pytest; else echo "No server tests found; skipping pytest."; fi

# Lint code
[group('quality')]
lint target="all":
    @case "{{ target }}" in \
      all) \
        echo "Linting server, web, and bridge..."; \
        cd server && uv run --group dev ruff check .; \
        cd ../web && pnpm run lint; \
        cd ../bridge && ./gradlew ktlintCheck; \
        ;; \
      server) \
        echo "Linting fastapi application..."; \
        cd server && uv run --group dev ruff check .; \
        ;; \
      web) \
        echo "Linting web client..."; \
        cd web && pnpm run lint; \
        ;; \
      bridge) \
        echo "Linting bridge sources..."; \
        cd bridge && ./gradlew ktlintCheck; \
        ;; \
      *) \
        echo "Unknown lint target: {{ target }} (expected: all|server|web|bridge)"; \
        exit 1; \
        ;; \
    esac

# Run checks
[group('quality')]
check target="all":
    @case "{{ target }}" in \
      all) \
        echo "Checking server, web, and bridge..."; \
        just check server; \
        just check web; \
        just check bridge; \
        ;; \
      server) \
        just check-server; \
        ;; \
      web) \
        just check-web; \
        ;; \
      bridge) \
        just check-bridge; \
        ;; \
      *) \
        echo "Unknown check target: {{ target }} (expected: all|server|web|bridge)"; \
        exit 1; \
        ;; \
    esac

# Check server
[private]
check-server:
    @echo "Running server checks..."
    cd server && uv run --group dev ruff check .
    cd server && if rg --files -g 'test_*.py' -g '*_test.py' >/dev/null; then uv run --group dev pytest; else echo "No server tests found; skipping pytest."; fi

# Check web
[private]
check-web:
    @echo "Running web checks..."
    cd web && pnpm run check:all

# Check bridge
[private]
check-bridge:
    @echo "Running bridge checks..."
    cd bridge && ./gradlew build

# CI: server
[private]
ci-server:
    @just format-check-server
    @just check server
    @just build server

# CI: web
[private]
ci-web:
    @just lint web
    @just check web
    @just build web

# CI: bridge
[private]
ci-bridge:
    @just lint bridge
    @just check bridge
    @just build bridge

# Run CI checks
[group('quality')]
ci target="all":
    @case "{{ target }}" in \
      all) \
        echo "Running CI checks for server, web, and bridge..."; \
        just ci server; \
        just ci web; \
        just ci bridge; \
        ;; \
      server) \
        just ci-server; \
        ;; \
      web) \
        just ci-web; \
        ;; \
      bridge) \
        just ci-bridge; \
        ;; \
      *) \
        echo "Unknown ci target: {{ target }} (expected: all|server|web|bridge)"; \
        exit 1; \
        ;; \
    esac

# Run all checks
[private]
check-all:
    @just check

# Smoke-test running server/web endpoints
[group('quality')]
smoke:
    @echo "Running smoke checks..."
    curl -fsS "http://127.0.0.1:{{ server_port }}/api/v2/health" >/dev/null
    curl -fsS "http://127.0.0.1:{{ web_port }}" >/dev/null
    echo "Smoke checks passed."

# Audit server dependencies
[private]
audit-server:
    @echo "Auditing Python dependencies..."
    cd server && uv run pip-audit

# Audit web dependencies
[private]
audit-web:
    @echo "Auditing Node dependencies..."
    cd web && pnpm audit --prod

# Audit dependencies
[group('quality')]
audit target="all":
    @case "{{ target }}" in \
      all) \
        echo "Auditing server and web dependencies..."; \
        just audit server; \
        just audit web; \
        ;; \
      server) \
        just audit-server; \
        ;; \
      web) \
        just audit-web; \
        ;; \
      *) \
        echo "Unknown audit target: {{ target }} (expected: all|server|web)"; \
        exit 1; \
        ;; \
    esac

# Release checks
[group('quality')]
release:
    @just format
    @just lint
    @just check
    @just build

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
