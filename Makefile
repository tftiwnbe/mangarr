SERVER_PORT := $(shell cd server && uv run python -c "from app.config import settings; print(settings.server.port)")
STATIC_DIR := server/app/static
BRIDGE_DIR := bridge

.PHONY: help docker bridge install generate-stubs generate-types dev-server dev-web dev test lint lint-server lint-web format format-server format-web audit audit-server audit-web clean

help:  ## Show available commands
	@echo "Available commands:"
	@awk 'BEGIN {FS = ":.*## "}; /^[a-zA-Z0-9_-]+:.*## / {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

docker: ## Start production stack with Docker Compose
	@echo "Starting docker compose stack..."
	docker compose up --build

android-stubs: ## Refresh Android compatibility stubs
	@echo "Refreshing android-stubs..."
	./bridge/AndroidCompat/getAndroid.sh

bridge: ## Build tachibridge jar
	@echo "Building tachibridge jar..."
	@if [ ! -f "bridge/app/lib/android.jar" ]; then \
		echo "android.jar not found, fetching..."; \
		./bridge/AndroidCompat/getAndroid.sh; \
	fi
	cd bridge && ./gradlew clean shadowJar
	@mkdir -p config/bin
	@mv -f bridge/app/build/*.jar config/bin/
	@echo "Tachibridge jar built successfully."

install: ## Install development dependencies
	@echo "Installing development dependencies..."
	cd ./server && uv sync --group dev
	cd ./web && pnpm install

generate-stubs: ## Generate Python gRPC Stubs
	@echo "Generating stubs..."
	cd server && uv run -m grpc_tools.protoc \
	--proto_path ../bridge/app/src/main/proto \
  --python_out=./app/bridge/proto \
	--pyi_out=./app/bridge/proto \
  --grpc_python_out=./app/bridge/proto \
  mangarr/tachibridge/tachibridge.proto \
	mangarr/tachibridge/extensions/extensions.proto \
	mangarr/tachibridge/config/config.proto

generate-types: ## Turns OpenAPI schemas into TypeScript types
	@echo "Checking if backend is running..."
	@if ! nc -z localhost $(SERVER_PORT); then \
		echo "Backend not running on port $(SERVER_PORT)"; \
		exit 1; \
	fi
	@echo "Generating types for endpoints..."
	cd ./web && pnpm run generate:api

dev-server: ## Start fastapi dev server
	@echo "Starting fastapi in dev mode..."
	cd ./server && uv run fastapi dev --host 0.0.0.0 --port $(SERVER_PORT)

dev-web: ## Start vite dev server
	@echo "Starting vite dev server..."
	cd ./web && pnpm run dev --open

dev-docker: ## Start container for development
	@echo "Starting docker compose dev stack..."
	docker compose -f compose.dev.yaml up --build

run: ## Build web, and start server, check if it works together
	@echo "Building web..."
	cd ./web && pnpm run build
	@echo "Starting uvicorn..."
	cd ./server && uv run python -m app.main

test: ## Run test suite for server
	@echo "Testing fastapi application..."
	cd ./server && uv run --group dev pytest

lint-server: ## Run Ruff diagnostics on the server
	@echo "Linting fastapi application..."
	cd ./server && uv run --group dev ruff check .

lint-web: ## Run ESLint/Prettier checks for the web client
	@echo "Linting web client..."
	cd ./web && pnpm run lint

lint: lint-server lint-web ## Run all linting tasks

format-server: ## Apply Ruff formatting to the server
	@echo "Formatting fastapi application..."
	cd ./server && uv run --group dev ruff format .

format-web: ## Apply Prettier formatting to the web client
	@echo "Formatting web client..."
	cd ./web && pnpm run format

format: format-server format-web ## Run all formatting tasks

audit-server: ## Audit Python dependencies for known vulnerabilities
	@echo "Auditing Python dependencies..."
	cd ./server && uv run pip-audit

audit-web: ## Audit Node dependencies for known vulnerabilities
	@echo "Auditing Node dependencies..."
	cd ./web && pnpm audit --prod

audit: audit-server audit-web ## Run all dependency audits

clean:  ## Remove runtime files
	@echo "Removing runtime files..."
	find . -name ".venv" -type d -prune -exec rm -rf {} +
	find . -name "node_modules" -type d -prune -exec rm -rf {} +
	find . -name "dist" -type d -prune -exec rm -rf '{}' +
	find . -name "build" -type d -prune -exec rm -rf '{}' +
	find . -name ".svelte-kit" -type d -prune -exec rm -rf '{}' +
	find . -name "coverage" -type d -prune -exec rm -rf '{}' +
	find . -name ".pnpm-store" -type d -prune -exec rm -rf '{}' +
	find . -name ".gradle" -type d -prune -exec rm -rf '{}' +
	@if [ -d "$(STATIC_DIR)" ]; then \
		echo "Removing generated static files in $(STATIC_DIR)"; \
		rm -rf $(STATIC_DIR)/*; \
	fi
