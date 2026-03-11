set shell := ["bash", "-eu", "-o", "pipefail", "-c"]
set unstable := true

web_port := "3737"
worker_port := "3212"

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
    cd ../worker && pnpm install

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
    docker compose -f compose.dev.yaml exec -T mangarr sh -lc 'cd /app/web && pnpm run convex:codegen'

# Start worker dev server
[group('dev')]
dev-worker:
    @echo "Starting worker dev server..."
    cd worker && pnpm run dev

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

# Build web and worker
[group('runtime')]
run:
    @echo "Building web and worker..."
    cd web && pnpm run build
    cd ../worker && pnpm run build

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
        echo "Building web, worker, and bridge..."; \
        cd web && pnpm run build; \
        cd ../worker && pnpm run build; \
        if [ ! -f "../bridge/app/lib/android.jar" ]; then echo "android.jar not found, fetching..."; ../bridge/AndroidCompat/getAndroid.sh; fi; \
        cd ../bridge && ./gradlew shadowJar; \
        cd .. && mkdir -p config/bin && cp -f bridge/app/build/*.jar config/bin/; \
        ;; \
      web) \
        echo "Building web client..."; \
        cd web && pnpm run build; \
        ;; \
      worker) \
        echo "Building worker service..."; \
        cd worker && pnpm run build; \
        ;; \
      bridge) \
        echo "Building bridge jar..."; \
        if [ ! -f "bridge/app/lib/android.jar" ]; then echo "android.jar not found, fetching..."; ./bridge/AndroidCompat/getAndroid.sh; fi; \
        cd bridge && ./gradlew shadowJar; \
        cd .. && mkdir -p config/bin && cp -f bridge/app/build/*.jar config/bin/; \
        ;; \
      *) \
        echo "Unknown build target: {{ target }} (expected: all|web|worker|bridge)"; \
        exit 1; \
        ;; \
    esac

# Format code
[group('quality')]
format target="all":
    @case "{{ target }}" in \
      all) \
        echo "Web formatter is not configured yet; skipping web format."; \
        echo "Worker formatter is not configured yet; skipping worker format."; \
        cd bridge && ./gradlew ktlintFormat; \
        ;; \
      web) \
        echo "Web formatter is not configured yet; skipping."; \
        ;; \
      worker) \
        echo "Worker formatter is not configured yet; skipping."; \
        ;; \
      bridge) \
        echo "Formatting bridge sources..."; \
        cd bridge && ./gradlew ktlintFormat; \
        ;; \
      *) \
        echo "Unknown format target: {{ target }} (expected: all|web|worker|bridge)"; \
        exit 1; \
        ;; \
    esac

# Lint code
[group('quality')]
lint target="all":
    @case "{{ target }}" in \
      all) \
        echo "Linting web, worker, and bridge..."; \
        cd web && pnpm run lint; \
        cd ../worker && pnpm run check; \
        cd ../bridge && ./gradlew ktlintCheck; \
        ;; \
      web) \
        echo "Linting web client..."; \
        cd web && pnpm run lint; \
        ;; \
      worker) \
        echo "Linting worker service..."; \
        cd worker && pnpm run check; \
        ;; \
      bridge) \
        echo "Linting bridge sources..."; \
        cd bridge && ./gradlew ktlintCheck; \
        ;; \
      *) \
        echo "Unknown lint target: {{ target }} (expected: all|web|worker|bridge)"; \
        exit 1; \
        ;; \
    esac

# Run checks
[group('quality')]
check target="all":
    @case "{{ target }}" in \
      all) \
        (cd web && pnpm run check); \
        (cd worker && pnpm run check); \
        (cd bridge && ./gradlew build); \
        ;; \
      web) \
        echo "Running web checks..."; \
        cd web && pnpm run check; \
        ;; \
      worker) \
        echo "Running worker checks..."; \
        cd worker && pnpm run check; \
        ;; \
      bridge) \
        echo "Running bridge checks..."; \
        cd bridge && ./gradlew build; \
        ;; \
      *) \
        echo "Unknown check target: {{ target }} (expected: all|web|worker|bridge)"; \
        exit 1; \
        ;; \
    esac

# Run CI checks
[group('quality')]
ci target="all":
    @case "{{ target }}" in \
      all) \
        echo "Running CI checks for web, worker, and bridge..."; \
        (cd web && pnpm run lint); \
        (cd web && pnpm run check); \
        (cd worker && pnpm run check); \
        (cd worker && pnpm run build); \
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
      worker) \
        echo "Running worker CI checks..."; \
        (cd worker && pnpm run check); \
        (cd worker && pnpm run build); \
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
        echo "Unknown ci target: {{ target }} (expected: all|web|worker|bridge)"; \
        exit 1; \
        ;; \
    esac

# Smoke-test running web/worker endpoints
[group('quality')]
smoke:
    @echo "Running smoke checks..."
    curl -fsS "http://127.0.0.1:{{ web_port }}" >/dev/null
    docker compose -f compose.dev.yaml exec -T mangarr curl -fsS "http://127.0.0.1:{{ worker_port }}/health" >/dev/null
    echo "Smoke checks passed."

# Audit dependencies
[group('quality')]
audit target="all":
    @case "{{ target }}" in \
      all) \
        echo "Auditing web and worker dependencies..."; \
        cd web && pnpm audit --prod; \
        cd ../worker && pnpm audit --prod; \
        ;; \
      web) \
        echo "Auditing Node dependencies..."; \
        cd web && pnpm audit --prod; \
        ;; \
      worker) \
        echo "Auditing worker dependencies..."; \
        cd worker && pnpm audit --prod; \
        ;; \
      *) \
        echo "Unknown audit target: {{ target }} (expected: all|web|worker)"; \
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
