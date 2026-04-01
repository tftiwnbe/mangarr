set shell := ["bash", "-eu", "-o", "pipefail", "-c"]
set unstable := true

web_port := "3737"
bridge_port := "3212"

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
    cd web && pnpm install

# Refresh Android compatibility stubs
[group('generate')]
android-stubs:
    @echo "Refreshing android-stubs..."
    ./bridge/AndroidCompat/getAndroid.sh

# Start Vite dev server
[group('dev')]
dev-web:
    @echo "Starting vite dev server..."
    cd web && pnpm run dev -- --host 0.0.0.0 --port {{ web_port }} --open

# Start Convex dev process
[group('dev')]
dev-convex:
    @echo "Convex now starts inside the mangarr container. Use just dev-docker."

# Push Convex functions and schema to the local self-hosted backend once
[group('dev')]
convex-push:
    @echo "Pushing Convex functions through the running mangarr container..."
    docker compose -f compose.dev.yaml exec -T mangarr sh -lc 'cd /app/web && pnpm exec convex dev --once --typecheck disable --codegen disable'

# Regenerate Convex _generated files manually (tracked in git)
[group('dev')]
convex-codegen:
    @echo "Regenerating Convex generated files through the running mangarr container..."
    docker compose -f compose.dev.yaml exec -T mangarr sh -lc '\
      set -eu; \
      CONVEX_ROOT="${CONVEX_ROOT:-/app/config/convex}"; \
      INSTANCE_NAME="${INSTANCE_NAME:-mangarr}"; \
      SECRET_FILE="${CONVEX_ROOT}/instance_secret"; \
      INSTANCE_SECRET="$(cat "${SECRET_FILE}")"; \
      ADMIN_KEY="$(/app/convex/generate_key "${INSTANCE_NAME}" "${INSTANCE_SECRET}" | tail -n1)"; \
      CONVEX_INTERNAL_URL="${CONVEX_URL:-${CONVEX_SELF_HOSTED_URL:-http://127.0.0.1:${CONVEX_PORT:-3210}}}"; \
      cd /app/web; \
      export CONVEX_URL="${CONVEX_INTERNAL_URL}" CONVEX_SELF_HOSTED_URL="${CONVEX_INTERNAL_URL}" CONVEX_ADMIN_KEY="${ADMIN_KEY}" CONVEX_SELF_HOSTED_ADMIN_KEY="${ADMIN_KEY}"; \
      pnpm exec convex codegen --typecheck disable'

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
    docker compose up

# Build web and bridge
[group('runtime')]
run:
    @echo "Building web and bridge..."
    cd web && pnpm run build
    cd ../bridge && ./gradlew shadowJar

# Build tachibridge jar
[group('build')]
bridge:
    @echo "Building bridge jar..."
    if [ ! -f "bridge/app/lib/android.jar" ]; then echo "android.jar not found, fetching..."; ./bridge/AndroidCompat/getAndroid.sh; fi
    cd bridge && ./gradlew shadowJar
    mkdir -p config/bin
    cp -f bridge/app/build/*.jar config/bin/

# Build project
[group('build')]
build target="all":
    @case "{{ target }}" in \
      all) \
        echo "Building web and bridge..."; \
        cd web && pnpm run build; \
        if [ ! -f "../bridge/app/lib/android.jar" ]; then echo "android.jar not found, fetching..."; ../bridge/AndroidCompat/getAndroid.sh; fi; \
        cd ../bridge && ./gradlew shadowJar; \
        cd .. && mkdir -p config/bin && cp -f bridge/app/build/*.jar config/bin/; \
        ;; \
      web) \
        echo "Building web client..."; \
        cd web && pnpm run build; \
        ;; \
      bridge) \
        echo "Building bridge jar..."; \
        if [ ! -f "bridge/app/lib/android.jar" ]; then echo "android.jar not found, fetching..."; ./bridge/AndroidCompat/getAndroid.sh; fi; \
        cd bridge && ./gradlew shadowJar; \
        cd .. && mkdir -p config/bin && cp -f bridge/app/build/*.jar config/bin/; \
        ;; \
      *) \
        echo "Unknown build target: {{ target }} (expected: all|web|bridge)"; \
        exit 1; \
        ;; \
    esac

# Prepare runtime artifacts outside Docker for faster image assembly
[group('build')]
artifacts:
    @echo "Preparing runtime artifacts..."
    rm -rf .artifacts
    mkdir -p .artifacts
    cd web && pnpm run build
    ./scripts/prepare-web-runtime-artifact.sh .artifacts/web-runtime.tgz
    if [ ! -f "bridge/app/lib/android.jar" ]; then echo "android.jar not found, fetching..."; ./bridge/AndroidCompat/getAndroid.sh; fi
    cd bridge && ./gradlew shadowJar --no-daemon
    ./scripts/prepare-bridge-runtime-artifact.sh .artifacts/bridge-runtime.tgz

# Build the production image from prebuilt local artifacts
[group('build')]
docker-fast image="mangarr-local-fast":
    @echo "Building runtime image from local artifacts..."
    just artifacts
    rm -rf .artifacts/ci-context
    mkdir -p .artifacts/ci-context/web-runtime .artifacts/ci-context/bridge-runtime
    cp Dockerfile.ci .artifacts/ci-context/Dockerfile.ci
    tar -xzf .artifacts/web-runtime.tgz -C .artifacts/ci-context/web-runtime
    tar -xzf .artifacts/bridge-runtime.tgz -C .artifacts/ci-context/bridge-runtime
    docker build --target mangarr-base -t mangarr-base:local .
    docker build -f .artifacts/ci-context/Dockerfile.ci --build-arg MANGARR_BASE_IMAGE=mangarr-base:local -t {{ image }} .artifacts/ci-context

# Format code
[group('quality')]
format target="all":
    @case "{{ target }}" in \
      all) \
        echo "Web formatter is not configured yet; skipping web format."; \
        cd bridge && ./gradlew ktlintFormat; \
        ;; \
      web) \
        echo "Web formatter is not configured yet; skipping."; \
        ;; \
      bridge) \
        echo "Formatting bridge sources..."; \
        cd bridge && ./gradlew ktlintFormat; \
        ;; \
      *) \
        echo "Unknown format target: {{ target }} (expected: all|web|bridge)"; \
        exit 1; \
        ;; \
    esac

# Lint code
[group('quality')]
lint target="all":
    @case "{{ target }}" in \
      all) \
        echo "Linting web and bridge..."; \
        cd web && pnpm run lint; \
        cd ../bridge && ./gradlew ktlintCheck; \
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
        echo "Unknown lint target: {{ target }} (expected: all|web|bridge)"; \
        exit 1; \
        ;; \
    esac

# Run checks
[group('quality')]
check target="all":
    @case "{{ target }}" in \
      all) \
        (cd web && pnpm run check); \
        (cd bridge && ./gradlew build); \
        ;; \
      web) \
        echo "Running web checks..."; \
        cd web && pnpm run check; \
        ;; \
      bridge) \
        echo "Running bridge checks..."; \
        cd bridge && ./gradlew build; \
        ;; \
      *) \
        echo "Unknown check target: {{ target }} (expected: all|web|bridge)"; \
        exit 1; \
        ;; \
    esac

# Run CI checks
[group('quality')]
ci target="all":
    @case "{{ target }}" in \
      all) \
        echo "Running CI checks for web and bridge..."; \
        (cd web && pnpm run lint); \
        (cd web && pnpm run check); \
        (cd bridge && ./gradlew ktlintCheck); \
        (cd bridge && ./gradlew build); \
        if [ ! -f "bridge/app/lib/android.jar" ]; then echo "android.jar not found, fetching..."; ./bridge/AndroidCompat/getAndroid.sh; fi; \
        (cd bridge && ./gradlew shadowJar); \
        mkdir -p config/bin && cp -f bridge/app/build/*.jar config/bin/; \
        ;; \
      web) \
        echo "Running web CI checks..."; \
        (cd web && pnpm run lint); \
        (cd web && pnpm run check); \
        ;; \
      bridge) \
        echo "Running bridge CI checks..."; \
        (cd bridge && ./gradlew ktlintCheck); \
        (cd bridge && ./gradlew build); \
        if [ ! -f "bridge/app/lib/android.jar" ]; then echo "android.jar not found, fetching..."; ./bridge/AndroidCompat/getAndroid.sh; fi; \
        (cd bridge && ./gradlew shadowJar); \
        mkdir -p config/bin && cp -f bridge/app/build/*.jar config/bin/; \
        ;; \
      *) \
        echo "Unknown ci target: {{ target }} (expected: all|web|bridge)"; \
        exit 1; \
        ;; \
    esac

# Smoke-test running web/bridge endpoints
[group('quality')]
smoke:
    @echo "Running smoke checks..."
    curl -fsS "http://127.0.0.1:{{ web_port }}" >/dev/null
    docker compose -f compose.dev.yaml exec -T mangarr curl -fsS "http://127.0.0.1:{{ bridge_port }}/health" >/dev/null
    echo "Smoke checks passed."

# Run web unit tests explicitly instead of on container startup
[group('quality')]
test-web-unit args="--run":
    @echo "Running web unit tests..."
    cd web && pnpm run test:unit -- {{ args }}

# Run web browser tests against a running local runtime
[group('quality')]
test-web-e2e specs="e2e/app-smoke.spec.ts":
    @echo "Running web end-to-end tests..."
    cd web && PLAYWRIGHT_BASE_URL="http://127.0.0.1:{{ web_port }}" pnpm run test:e2e -- {{ specs }}

# Rebuild the local runtime and then verify it explicitly
[group('quality')]
verify-runtime wait="15" specs="e2e/app-smoke.spec.ts":
    @echo "Rebuilding local runtime and running verification checks..."
    docker compose -f compose.dev.yaml up -d --build --force-recreate mangarr
    sleep {{ wait }}
    curl -fsS "http://127.0.0.1:{{ web_port }}" >/dev/null
    docker compose -f compose.dev.yaml exec -T mangarr curl -fsS "http://127.0.0.1:{{ bridge_port }}/health" >/dev/null
    cd web && PLAYWRIGHT_BASE_URL="http://127.0.0.1:{{ web_port }}" pnpm run test:e2e -- {{ specs }}

# Start a fresh production-like stack with temporary host directories and smoke it
[group('quality')]
verify-prod tmp_root="/tmp/mangarr-predeploy" port="3837":
    @echo "Running production-like verification with fresh host volumes..."
    rm -rf "{{ tmp_root }}"
    mkdir -p "{{ tmp_root }}/config" "{{ tmp_root }}/downloads"
    printf '%s\n' \
      'services:' \
      '  mangarr:' \
      '    platform: linux/amd64' \
      '    build:' \
      '      context: /Users/wnbe/Lab/mangarr' \
      '      dockerfile: Dockerfile' \
      '      target: mangarr-runtime' \
      '    environment:' \
      '      - MANGARR_PUBLIC_URL=http://127.0.0.1:{{ port }}' \
      '    ports:' \
      '      - "{{ port }}:3737"' \
      '    volumes:' \
      '      - {{ tmp_root }}/config:/app/config' \
      '      - {{ tmp_root }}/downloads:/app/downloads' \
      > "{{ tmp_root }}/compose.verify.yaml"
    docker compose -p mangarr-predeploy -f "{{ tmp_root }}/compose.verify.yaml" down --remove-orphans >/dev/null 2>&1 || true
    docker compose -p mangarr-predeploy -f "{{ tmp_root }}/compose.verify.yaml" up -d --build
    for i in $(seq 1 24); do \
      if curl -fsS "http://127.0.0.1:{{ port }}/login" >/dev/null 2>/dev/null; then break; fi; \
      sleep 5; \
      if [ "$i" -eq 24 ]; then echo "Production-like smoke check timed out waiting for web startup" >&2; exit 1; fi; \
    done
    docker compose -p mangarr-predeploy -f "{{ tmp_root }}/compose.verify.yaml" ps
    docker compose -p mangarr-predeploy -f "{{ tmp_root }}/compose.verify.yaml" down --remove-orphans

# Tail current runtime logs from the dev container
[group('runtime')]
logs-runtime lines="200":
    docker compose -f compose.dev.yaml logs --tail {{ lines }} -f mangarr

# Audit dependencies
[group('quality')]
audit target="all":
    @case "{{ target }}" in \
      all) \
        echo "Auditing web dependencies..."; \
        cd web && pnpm audit --prod; \
        ;; \
      web) \
        echo "Auditing Node dependencies..."; \
        cd web && pnpm audit --prod; \
        ;; \
      *) \
        echo "Unknown audit target: {{ target }} (expected: all|web)"; \
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
    find . -name "node_modules" -type d -prune -exec rm -rf {} +
    find . -name "dist" -type d -prune -exec rm -rf '{}' +
    find . -name "build" -type d -prune -exec rm -rf '{}' +
    find . -name ".svelte-kit" -type d -prune -exec rm -rf '{}' +
    find . -name "coverage" -type d -prune -exec rm -rf '{}' +
    find . -name ".pnpm-store" -type d -prune -exec rm -rf '{}' +
    find . -name ".gradle" -type d -prune -exec rm -rf '{}' +
