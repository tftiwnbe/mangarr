# syntax=docker/dockerfile:1

FROM ghcr.io/get-convex/convex-backend:latest AS convex-backend

FROM node:24-alpine AS web-base
WORKDIR /app/web

RUN corepack enable

COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile


FROM web-base AS web-dev
CMD ["sh", "-c", "if [ ! -d node_modules/.pnpm ]; then pnpm install --frozen-lockfile; fi && pnpm run dev"]


FROM web-base AS web-build
COPY web/ .
RUN pnpm run build


FROM node:24-alpine AS web-runtime
WORKDIR /app/web

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3737

RUN corepack enable

COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=web-build /app/web/build ./build

EXPOSE 3737

CMD ["node", "build"]


FROM eclipse-temurin:21-jre AS java-runtime


FROM eclipse-temurin:21-jdk AS bridge-build
WORKDIR /app/bridge

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl zip ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY bridge/gradlew /app/bridge/gradlew
COPY bridge/gradle /app/bridge/gradle

RUN chmod +x ./gradlew

RUN --mount=type=cache,id=mangarr-gradle-wrapper,target=/root/.gradle/wrapper,sharing=locked \
    ./gradlew --no-daemon --version

COPY bridge ./

RUN bash ./AndroidCompat/getAndroid.sh

RUN --mount=type=cache,id=mangarr-gradle-wrapper,target=/root/.gradle/wrapper,sharing=locked \
    --mount=type=cache,id=mangarr-gradle-caches,target=/root/.gradle/caches,sharing=locked \
    --mount=type=cache,id=mangarr-gradle-project,target=/app/bridge/.gradle,sharing=locked \
    ./gradlew --no-daemon shadowJar


FROM node:24-bookworm-slim AS worker-base
WORKDIR /app/worker

ENV JAVA_HOME=/opt/java/openjdk \
    PATH=/opt/java/openjdk/bin:$PATH

COPY --from=java-runtime /opt/java/openjdk /opt/java/openjdk

RUN corepack enable && \
    apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY worker/package.json worker/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile


FROM worker-base AS worker-dev
RUN mkdir -p /app/bin
COPY --from=bridge-build /app/bridge/app/build/tachibridge-*.jar /app/bin/
RUN sh -c 'jar=$(echo /app/bin/tachibridge-*.jar); cp "$jar" /app/bin/tachibridge.jar'

CMD ["sh", "-c", "if [ ! -d node_modules/.pnpm ]; then pnpm install --frozen-lockfile; fi && pnpm run dev"]


FROM worker-base AS worker-build
COPY worker/ .
RUN pnpm run build


FROM node:24-bookworm-slim AS worker-runtime
WORKDIR /app/worker

ENV NODE_ENV=production \
    JAVA_HOME=/opt/java/openjdk \
    PATH=/opt/java/openjdk/bin:$PATH \
    MANGARR_WORKER_HOST=0.0.0.0 \
    MANGARR_WORKER_PORT=3212 \
    TACHIBRIDGE_JAR_PATH=/app/bin/tachibridge.jar

COPY --from=java-runtime /opt/java/openjdk /opt/java/openjdk

RUN corepack enable && \
    apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY worker/package.json worker/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=worker-build /app/worker/dist ./dist

RUN mkdir -p /app/bin
COPY --from=bridge-build /app/bridge/app/build/tachibridge-*.jar /app/bin/
RUN sh -c 'jar=$(echo /app/bin/tachibridge-*.jar); cp "$jar" /app/bin/tachibridge.jar'

EXPOSE 3212

CMD ["pnpm", "run", "start"]


FROM node:24-trixie-slim AS mangarr-base
WORKDIR /app

SHELL ["/bin/bash", "-lc"]

ENV JAVA_HOME=/opt/java/openjdk \
    PATH=/opt/java/openjdk/bin:$PATH

COPY --from=java-runtime /opt/java/openjdk /opt/java/openjdk
COPY --from=convex-backend /convex /app/convex

RUN corepack enable && \
    apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates tini && \
    rm -rf /var/lib/apt/lists/*

RUN cat <<'EOF' >/usr/local/bin/mangarr-startup
#!/usr/bin/env bash
set -euo pipefail

CONVEX_INTERNAL_URL="${CONVEX_URL:-${CONVEX_SELF_HOSTED_URL:-http://127.0.0.1:3210}}"
CONVEX_ROOT="${CONVEX_ROOT:-/app/config/convex}"
CONVEX_STORAGE_DIR="${CONVEX_STORAGE_DIR:-${CONVEX_ROOT}/storage}"
CONVEX_TMP_DIR="${CONVEX_TMP_DIR:-${CONVEX_ROOT}/tmp}"
CONVEX_SQLITE_PATH="${CONVEX_SQLITE_PATH:-${CONVEX_ROOT}/db.sqlite3}"
INSTANCE_NAME="${INSTANCE_NAME:-mangarr}"
MANGARR_WORKER_HOST="${MANGARR_WORKER_HOST:-127.0.0.1}"
MANGARR_WORKER_PORT="${MANGARR_WORKER_PORT:-3212}"
MANGARR_WORKER_INTERNAL_URL="${MANGARR_WORKER_INTERNAL_URL:-http://127.0.0.1:${MANGARR_WORKER_PORT}}"

mkdir -p "${CONVEX_ROOT}" "${CONVEX_STORAGE_DIR}" "${CONVEX_TMP_DIR}" "$(dirname "${CONVEX_SQLITE_PATH}")"

SECRET_FILE="${CONVEX_ROOT}/instance_secret"
if [ ! -s "${SECRET_FILE}" ]; then
  head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "${SECRET_FILE}"
fi
chmod 600 "${SECRET_FILE}"
INSTANCE_SECRET="$(cat "${SECRET_FILE}")"

SERVICE_SECRET_FILE="${CONVEX_ROOT}/service_secret"
if [ ! -s "${SERVICE_SECRET_FILE}" ]; then
  head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "${SERVICE_SECRET_FILE}"
fi
chmod 600 "${SERVICE_SECRET_FILE}"
MANGARR_SERVICE_SECRET="${MANGARR_SERVICE_SECRET:-$(cat "${SERVICE_SECRET_FILE}")}"

: > /app/web/.env.local

ADMIN_KEY="$("/app/convex/generate_key" "${INSTANCE_NAME}" "${INSTANCE_SECRET}" | tail -n1)"
if [ "${MANGARR_APP_MODE:-prod}" = "dev" ]; then
  echo "Convex dev admin key: ${ADMIN_KEY}"
fi
export HOST="${HOST:-0.0.0.0}" PORT="${PORT:-3737}" PUBLIC_CONVEX_URL="${PUBLIC_CONVEX_URL:-http://127.0.0.1:3210}" CONVEX_URL="${CONVEX_INTERNAL_URL}" CONVEX_SELF_HOSTED_URL="${CONVEX_INTERNAL_URL}" CONVEX_ADMIN_KEY="${ADMIN_KEY}" CONVEX_SELF_HOSTED_ADMIN_KEY="${ADMIN_KEY}" MANGARR_SERVICE_SECRET="${MANGARR_SERVICE_SECRET}" MANGARR_WORKER_HOST="${MANGARR_WORKER_HOST}" MANGARR_WORKER_PORT="${MANGARR_WORKER_PORT}" MANGARR_WORKER_INTERNAL_URL="${MANGARR_WORKER_INTERNAL_URL}" MANGARR_WORKER_ID="${MANGARR_WORKER_ID:-main}" MANGARR_WORKER_HEARTBEAT_INTERVAL_MS="${MANGARR_WORKER_HEARTBEAT_INTERVAL_MS:-15000}" TACHIBRIDGE_PORT="${TACHIBRIDGE_PORT:-8181}" TACHIBRIDGE_JAR_PATH="${TACHIBRIDGE_JAR_PATH:-/app/bin/tachibridge.jar}"

/app/convex/convex-local-backend --instance-name "${INSTANCE_NAME}" --instance-secret "${INSTANCE_SECRET}" --port "${CONVEX_PORT:-3210}" --site-proxy-port "${CONVEX_SITE_PROXY_PORT:-3211}" --convex-origin "${PUBLIC_CONVEX_URL}" --convex-site "${CONVEX_SITE_ORIGIN:-http://127.0.0.1:3211}" --beacon-tag mangarr --disable-beacon --local-storage "${CONVEX_STORAGE_DIR}" "${CONVEX_SQLITE_PATH}" &

cleanup() {
  jobs -p | xargs -r kill 2>/dev/null || true
}
trap cleanup EXIT INT TERM

until curl -fsS "http://127.0.0.1:${CONVEX_PORT:-3210}/version" >/dev/null; do
  sleep 1
done

if [ "${MANGARR_APP_MODE:-prod}" = "dev" ]; then
  [ -d /app/web/node_modules/.pnpm ] || (cd /app/web && pnpm install --frozen-lockfile --force)
  [ -d /app/worker/node_modules/.pnpm ] || (cd /app/worker && pnpm install --frozen-lockfile --force)
fi

(cd /app/web && pnpm exec convex dev --once --typecheck disable --codegen enable)

if [ "${MANGARR_APP_MODE:-prod}" = "dev" ]; then
  (cd /app/worker && pnpm run dev) &
else
  (cd /app/worker && pnpm run start) &
fi

until curl -fsS "http://127.0.0.1:${MANGARR_WORKER_PORT}/health" >/dev/null; do
  sleep 1
done

if [ "${MANGARR_APP_MODE:-prod}" = "dev" ]; then
  (cd /app/web && pnpm run dev) &
else
  (cd /app/web && node build) &
fi

wait -n
EOF
RUN chmod +x /usr/local/bin/mangarr-startup

ENTRYPOINT ["tini", "--"]

FROM mangarr-base AS mangarr-dev
ENV MANGARR_APP_MODE=dev
RUN mkdir -p /app/bin /app/config /app/data /app/web /app/worker
COPY --from=bridge-build /app/bridge/app/build/tachibridge-*.jar /app/bin/
RUN sh -c 'jar=$(echo /app/bin/tachibridge-*.jar); cp "$jar" /app/bin/tachibridge.jar'

EXPOSE 3737

CMD ["/usr/local/bin/mangarr-startup"]


FROM mangarr-base AS mangarr-runtime
ENV MANGARR_APP_MODE=prod

WORKDIR /app/web
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY web /app/web
COPY --from=web-build /app/web/build /app/web/build

WORKDIR /app/worker
COPY worker/package.json worker/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY worker /app/worker
COPY --from=worker-build /app/worker/dist /app/worker/dist

WORKDIR /app
RUN mkdir -p /app/bin /app/config /app/data
COPY --from=bridge-build /app/bridge/app/build/tachibridge-*.jar /app/bin/
RUN sh -c 'jar=$(echo /app/bin/tachibridge-*.jar); cp "$jar" /app/bin/tachibridge.jar'

EXPOSE 3737

CMD ["/usr/local/bin/mangarr-startup"]
