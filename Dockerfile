# syntax=docker/dockerfile:1

FROM node:20-alpine AS frontend-build
WORKDIR /app/web

RUN corepack enable

COPY web/pnpm-lock.yaml web/package.json ./
COPY web/pnpm-workspace.yaml ./pnpm-workspace.yaml
RUN pnpm install --frozen-lockfile

COPY web/ .
RUN pnpm build


FROM eclipse-temurin:21-jdk AS bridge-build
WORKDIR /app/bridge

COPY bridge ./

RUN ./gradlew --no-daemon cli:installDist


FROM python:3.13-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN mkdir -p /app/bin

RUN apt-get update && \
    apt-get install -y --no-install-recommends openjdk-21-jre-headless && \
    rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir uv

ENV UV_LINK_MODE=copy

COPY server/pyproject.toml server/uv.lock /app/server/
WORKDIR /app/server
RUN uv sync --frozen --no-dev

COPY server /app/server
COPY --from=frontend-build /app/server/app/static /app/server/app/static
COPY --from=bridge-build /app/bridge/cli/build/install/cli /app/bin/cli

EXPOSE 3737

CMD ["uv", "run", "--frozen", "--no-dev", "python", "-m", "app.main"]
