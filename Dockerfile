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


FROM node:24-trixie-slim AS mangarr-base
WORKDIR /app

SHELL ["/bin/bash", "-lc"]

ENV JAVA_HOME=/opt/java/openjdk \
    PATH=/opt/java/openjdk/bin:$PATH

COPY --from=java-runtime /opt/java/openjdk /opt/java/openjdk
COPY --from=convex-backend /convex /app/convex

RUN corepack enable && \
    corepack prepare pnpm@10.32.1 --activate && \
    apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates tini dbus dbus-x11 \
      libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 \
      libexpat1 libfontconfig1 libgbm1 libgl1 libgl1-mesa-dri libglib2.0-0 \
      libgluegen2-jni libgtk-3-0 libnspr4 libnss3 libjogl2-jni \
      libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 \
      libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxkbcommon0 \
      libxrandr2 libxtst6 xvfb && \
    ln -sf /opt/java/openjdk/lib/server/libjvm.so /usr/lib/libjvm.so && \
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
MANGARR_BRIDGE_HOST="${MANGARR_BRIDGE_HOST:-127.0.0.1}"
MANGARR_BRIDGE_PORT="${MANGARR_BRIDGE_PORT:-3212}"
MANGARR_BRIDGE_INTERNAL_URL="${MANGARR_BRIDGE_INTERNAL_URL:-http://127.0.0.1:${MANGARR_BRIDGE_PORT}}"
MANGARR_DOWNLOADS_DIR="${MANGARR_DOWNLOADS_DIR:-/app/downloads}"
MANGARR_PUBLIC_HOST="${MANGARR_PUBLIC_HOST:-127.0.0.1}"
MANGARR_PUBLIC_SCHEME="${MANGARR_PUBLIC_SCHEME:-http}"
MANGARR_LOG_ROOT="${MANGARR_LOG_ROOT:-/app/config/logs}"
MANGARR_SYSTEM_LOG_DIR="${MANGARR_SYSTEM_LOG_DIR:-${MANGARR_LOG_ROOT}/system}"
MANGARR_BRIDGE_LOG_DIR="${MANGARR_BRIDGE_LOG_DIR:-${MANGARR_LOG_ROOT}/bridge}"
MANGARR_CONVEX_AUTH_ISSUER="${MANGARR_CONVEX_AUTH_ISSUER:-https://auth.mangarr.local/convex}"
MANGARR_CONVEX_AUTH_APPLICATION_ID="${MANGARR_CONVEX_AUTH_APPLICATION_ID:-mangarr-web}"
MANGARR_CONVEX_AUTH_TOKEN_TTL_SECONDS="${MANGARR_CONVEX_AUTH_TOKEN_TTL_SECONDS:-3600}"
MANGARR_CONVEX_AUTH_KEY_ID="${MANGARR_CONVEX_AUTH_KEY_ID:-mangarr-20260310}"
MANGARR_CONVEX_AUTH_PRIVATE_JWK="${MANGARR_CONVEX_AUTH_PRIVATE_JWK:-{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"wQ_V3WF3zt9VDJAjCxSurV-qo9bDqjfE6j4_76Q8JkU\",\"y\":\"8MDEofdMVTjhKLtpPUKWbgID5F8aJN17eNc5OXmNA5k\",\"d\":\"VpOZuu2eEPXIAEWRUtt1eSo13Ick2wOH8PWbrP4crz8\"}}"
MANGARR_KCEF_ENABLED="${MANGARR_KCEF_ENABLED:-true}"
MANGARR_XVFB_DISPLAY="${MANGARR_XVFB_DISPLAY:-:99}"
RUST_LOG="${RUST_LOG:-error,database::search_index_workers::retriable_worker=off}"

mkdir -p "${CONVEX_ROOT}" "${CONVEX_STORAGE_DIR}" "${CONVEX_TMP_DIR}" "$(dirname "${CONVEX_SQLITE_PATH}")" "${MANGARR_SYSTEM_LOG_DIR}" "${MANGARR_BRIDGE_LOG_DIR}"
STARTUP_LOG_STAMP="$(date -u +%Y%m%d-%H%M%S)"
CONVEX_LOG_FILE="${MANGARR_SYSTEM_LOG_DIR}/convex-${STARTUP_LOG_STAMP}.log"
CONVEX_NOISE_LOG_FILE="${MANGARR_SYSTEM_LOG_DIR}/convex-noise-${STARTUP_LOG_STAMP}.log"
SETUP_LOG_FILE="${MANGARR_SYSTEM_LOG_DIR}/setup-${STARTUP_LOG_STAMP}.log"
WEB_LOG_FILE="${MANGARR_SYSTEM_LOG_DIR}/web-${STARTUP_LOG_STAMP}.log"
BRIDGE_CONSOLE_LOG_FILE="${MANGARR_SYSTEM_LOG_DIR}/bridge-console-${STARTUP_LOG_STAMP}.log"
BRIDGE_NOISE_LOG_FILE="${MANGARR_SYSTEM_LOG_DIR}/bridge-native-noise-${STARTUP_LOG_STAMP}.log"
ln -sfn "$(basename "${CONVEX_LOG_FILE}")" "${MANGARR_SYSTEM_LOG_DIR}/convex.log"
ln -sfn "$(basename "${CONVEX_NOISE_LOG_FILE}")" "${MANGARR_SYSTEM_LOG_DIR}/convex-noise.log"
ln -sfn "$(basename "${SETUP_LOG_FILE}")" "${MANGARR_SYSTEM_LOG_DIR}/setup.log"
ln -sfn "$(basename "${WEB_LOG_FILE}")" "${MANGARR_SYSTEM_LOG_DIR}/web.log"
ln -sfn "$(basename "${BRIDGE_CONSOLE_LOG_FILE}")" "${MANGARR_SYSTEM_LOG_DIR}/bridge-console.log"
ln -sfn "$(basename "${BRIDGE_NOISE_LOG_FILE}")" "${MANGARR_SYSTEM_LOG_DIR}/bridge-native-noise.log"

mkdir -p "${MANGARR_DOWNLOADS_DIR}"

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

ADMIN_KEY="$("/app/convex/generate_key" "${INSTANCE_NAME}" "${INSTANCE_SECRET}" 2> >(grep -v '^Admin key:$' >&2) | tail -n1)"
if [ "${MANGARR_APP_MODE:-prod}" = "dev" ]; then
  echo "[startup] Convex dev admin key: ${ADMIN_KEY}"
fi
PUBLIC_CONVEX_URL="${PUBLIC_CONVEX_URL:-${MANGARR_PUBLIC_SCHEME}://${MANGARR_PUBLIC_HOST}:${CONVEX_PORT:-3210}}"
CONVEX_SITE_ORIGIN="${CONVEX_SITE_ORIGIN:-${MANGARR_PUBLIC_SCHEME}://${MANGARR_PUBLIC_HOST}:${PORT:-3737}}"
export HOST="${HOST:-0.0.0.0}" PORT="${PORT:-3737}" PUBLIC_CONVEX_URL="${PUBLIC_CONVEX_URL}" CONVEX_URL="${CONVEX_INTERNAL_URL}" CONVEX_SELF_HOSTED_URL="${CONVEX_INTERNAL_URL}" CONVEX_ADMIN_KEY="${ADMIN_KEY}" CONVEX_SELF_HOSTED_ADMIN_KEY="${ADMIN_KEY}" MANGARR_SERVICE_SECRET="${MANGARR_SERVICE_SECRET}" MANGARR_BRIDGE_HOST="${MANGARR_BRIDGE_HOST}" MANGARR_BRIDGE_PORT="${MANGARR_BRIDGE_PORT}" MANGARR_BRIDGE_INTERNAL_URL="${MANGARR_BRIDGE_INTERNAL_URL}" MANGARR_BRIDGE_ID="${MANGARR_BRIDGE_ID:-main}" MANGARR_BRIDGE_HEARTBEAT_INTERVAL_MS="${MANGARR_BRIDGE_HEARTBEAT_INTERVAL_MS:-15000}" MANGARR_BRIDGE_COMMAND_POLL_INTERVAL_MS="${MANGARR_BRIDGE_COMMAND_POLL_INTERVAL_MS:-350}" MANGARR_BRIDGE_COMMAND_LEASE_DURATION_MS="${MANGARR_BRIDGE_COMMAND_LEASE_DURATION_MS:-30000}" MANGARR_DOWNLOADS_DIR="${MANGARR_DOWNLOADS_DIR}" MANGARR_PUBLIC_HOST="${MANGARR_PUBLIC_HOST}" MANGARR_PUBLIC_SCHEME="${MANGARR_PUBLIC_SCHEME}" MANGARR_CONVEX_AUTH_ISSUER="${MANGARR_CONVEX_AUTH_ISSUER}" MANGARR_CONVEX_AUTH_APPLICATION_ID="${MANGARR_CONVEX_AUTH_APPLICATION_ID}" MANGARR_CONVEX_AUTH_TOKEN_TTL_SECONDS="${MANGARR_CONVEX_AUTH_TOKEN_TTL_SECONDS}" MANGARR_CONVEX_AUTH_KEY_ID="${MANGARR_CONVEX_AUTH_KEY_ID}" MANGARR_CONVEX_AUTH_PRIVATE_JWK="${MANGARR_CONVEX_AUTH_PRIVATE_JWK}" MANGARR_KCEF_ENABLED="${MANGARR_KCEF_ENABLED}" MANGARR_LOG_ROOT="${MANGARR_LOG_ROOT}" MANGARR_SYSTEM_LOG_DIR="${MANGARR_SYSTEM_LOG_DIR}" MANGARR_BRIDGE_LOG_DIR="${MANGARR_BRIDGE_LOG_DIR}" TACHIBRIDGE_JAR_PATH="${TACHIBRIDGE_JAR_PATH:-/app/bin/tachibridge.jar}" LD_LIBRARY_PATH="/opt/java/openjdk/lib/server:/opt/java/openjdk/lib:${LD_LIBRARY_PATH:-}" RUST_LOG="${RUST_LOG}"

pipe_component_output() {
  local component="$1"
  local logfile="$2"
  local stream="$3"
  local target="$4"
  while IFS= read -r line || [ -n "$line" ]; do
    local prefix="[${component}]"
    if [ -n "$stream" ]; then
      prefix="${prefix}[${stream}]"
    fi
    if [ "$target" = "stderr" ]; then
      printf '%s %s\n' "$prefix" "$line" | tee -a "$logfile" >&2
    else
      printf '%s %s\n' "$prefix" "$line" | tee -a "$logfile"
    fi
  done
}

filter_convex_stderr() {
  local logfile="$1"
  local noisefile="$2"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      *"cron_commit_mutation"*"_modules.by_path"*|*"finish_push"*"_modules.by_path"*)
        printf '[convex][noise] %s\n' "$line" >> "$noisefile"
        ;;
      *)
        printf '[convex][stderr] %s\n' "$line" | tee -a "$logfile" >&2
        ;;
    esac
  done
}

startup_note() {
  printf '[startup] %s\n' "$1" | tee -a "${SETUP_LOG_FILE}"
}

wait_for_http() {
  local name="$1"
  local url="$2"
  local attempts="${3:-120}"
  local delay_seconds="${4:-1}"
  local count=0
  until curl -fs "${url}" >/dev/null 2>/dev/null; do
    count=$((count + 1))
    if [ "$count" -ge "$attempts" ]; then
      startup_note "${name} failed to become ready: ${url}"
      return 1
    fi
    sleep "${delay_seconds}"
  done
  startup_note "${name} ready: ${url}"
}

filter_bridge_stderr() {
  local logfile="$1"
  local noisefile="$2"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      *"dbus/object_proxy.cc:590"*UPower*)
        printf '%s\n' "$line" >> "$noisefile"
        ;;
      JCEF_*|JCEF\(*|CEF\ Version\ =*|Chromium\ Version\ =*)
        printf '%s\n' "$line" >> "$noisefile"
        ;;
      *)
        printf '[bridge][stderr] %s\n' "$line" | tee -a "$logfile" >&2
        ;;
    esac
  done
}

filter_bridge_stdout() {
  local logfile="$1"
  local noisefile="$2"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      JCEF\(*|JCEF_*|CEF\ Version\ =*|Chromium\ Version\ =*)
        printf '%s\n' "$line" >> "$noisefile"
        ;;
      *)
        printf '[bridge] %s\n' "$line" | tee -a "$logfile"
        ;;
    esac
  done
}

/app/convex/convex-local-backend --instance-name "${INSTANCE_NAME}" --instance-secret "${INSTANCE_SECRET}" --port "${CONVEX_PORT:-3210}" --site-proxy-port "${CONVEX_SITE_PROXY_PORT:-3211}" --convex-origin "${PUBLIC_CONVEX_URL}" --convex-site "${CONVEX_SITE_ORIGIN:-http://127.0.0.1:3211}" --beacon-tag mangarr --disable-beacon --local-storage "${CONVEX_STORAGE_DIR}" "${CONVEX_SQLITE_PATH}" \
  > >(pipe_component_output "convex" "${CONVEX_LOG_FILE}" "" "stdout") \
  2> >(filter_convex_stderr "${CONVEX_LOG_FILE}" "${CONVEX_NOISE_LOG_FILE}") &

cleanup() {
  jobs -p | xargs -r kill 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait_for_http "Convex backend" "http://127.0.0.1:${CONVEX_PORT:-3210}/version"

if [ "${MANGARR_APP_MODE:-prod}" = "dev" ]; then
  [ -d /app/web/node_modules/.pnpm ] || (cd /app/web && pnpm install --frozen-lockfile --force)
fi

(cd /app/web && pnpm exec convex dev --once --typecheck disable --codegen disable) \
  > >(pipe_component_output "setup" "${SETUP_LOG_FILE}" "" "stdout") \
  2> >(pipe_component_output "setup" "${SETUP_LOG_FILE}" "stderr" "stderr")

KCEF_LIBRARY_DIR="${KCEF_INSTALL_DIR:-${MANGARR_BRIDGE_DATA_DIR:-/app/config/bridge}/bin/kcef}"
KCEF_CACHE_DIR="${MANGARR_BRIDGE_DATA_DIR:-/app/config/bridge}/cache/kcef"
JAVA_LIBRARY_PATH="${KCEF_LIBRARY_DIR}:/usr/lib/jni:/opt/java/openjdk/lib/server:/opt/java/openjdk/lib:/usr/lib:/lib"
export LD_LIBRARY_PATH="${KCEF_LIBRARY_DIR}:/usr/lib/jni:/opt/java/openjdk/lib/server:/opt/java/openjdk/lib:${LD_LIBRARY_PATH:-}"
export JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:+${JAVA_TOOL_OPTIONS} }-Djava.library.path=${JAVA_LIBRARY_PATH}"

if command -v dbus-daemon >/dev/null 2>&1; then
  mkdir -p /run/dbus
  dbus-daemon --system --fork --nopidfile >/dev/null 2>/dev/null || true
  export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/dbus/system_bus_socket}"
fi

if [ "${MANGARR_KCEF_ENABLED}" = "true" ] || [ "${MANGARR_KCEF_ENABLED}" = "1" ] || [ "${MANGARR_KCEF_ENABLED}" = "yes" ]; then
  if command -v Xvfb >/dev/null 2>&1; then
    mkdir -p /tmp/.X11-unix
    export DISPLAY="${DISPLAY:-${MANGARR_XVFB_DISPLAY}}"
    DISPLAY_NUMBER="$(printf '%s' "${DISPLAY}" | sed 's/^://')"
    pkill -f "Xvfb ${DISPLAY}" >/dev/null 2>/dev/null || true
    rm -f "/tmp/.X${DISPLAY_NUMBER}-lock" "/tmp/.X11-unix/X${DISPLAY_NUMBER}" 2>/dev/null || true
    Xvfb "${DISPLAY}" -screen 0 1920x1080x24 -nolisten tcp -ac &
  fi

  mkdir -p "${KCEF_CACHE_DIR}"
  find "${KCEF_CACHE_DIR}" -maxdepth 1 -name 'Singleton*' -delete 2>/dev/null || true
fi

(java -jar "${TACHIBRIDGE_JAR_PATH}" --port "${MANGARR_BRIDGE_PORT}" --data-dir "${MANGARR_BRIDGE_DATA_DIR:-/app/config/bridge}") \
  > >(filter_bridge_stdout "${BRIDGE_CONSOLE_LOG_FILE}" "${BRIDGE_NOISE_LOG_FILE}") \
  2> >(filter_bridge_stderr "${BRIDGE_CONSOLE_LOG_FILE}" "${BRIDGE_NOISE_LOG_FILE}") &

wait_for_http "Bridge runtime" "http://127.0.0.1:${MANGARR_BRIDGE_PORT}/health"

if [ "${MANGARR_APP_MODE:-prod}" = "dev" ]; then
  (cd /app/web && pnpm run dev) \
    > >(pipe_component_output "web" "${WEB_LOG_FILE}" "" "stdout") \
    2> >(pipe_component_output "web" "${WEB_LOG_FILE}" "stderr" "stderr") &
else
  (cd /app/web && node build) \
    > >(pipe_component_output "web" "${WEB_LOG_FILE}" "" "stdout") \
    2> >(pipe_component_output "web" "${WEB_LOG_FILE}" "stderr" "stderr") &
fi

wait_for_http "Web app" "http://127.0.0.1:${PORT:-3737}"
startup_note "Mangarr ready: web=${MANGARR_PUBLIC_SCHEME}://${MANGARR_PUBLIC_HOST}:${PORT:-3737} convex=${PUBLIC_CONVEX_URL} bridge=${MANGARR_BRIDGE_INTERNAL_URL}"
startup_note "Logs: setup=${SETUP_LOG_FILE} web=${WEB_LOG_FILE} bridge=${BRIDGE_CONSOLE_LOG_FILE} convex=${CONVEX_LOG_FILE}"

wait -n
EOF
RUN chmod +x /usr/local/bin/mangarr-startup

ENTRYPOINT ["tini", "--"]

FROM mangarr-base AS mangarr-dev
ENV MANGARR_APP_MODE=dev
RUN mkdir -p /app/bin /app/config /app/downloads /app/web
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

WORKDIR /app
RUN mkdir -p /app/bin /app/config /app/downloads
COPY --from=bridge-build /app/bridge/app/build/tachibridge-*.jar /app/bin/
RUN sh -c 'jar=$(echo /app/bin/tachibridge-*.jar); cp "$jar" /app/bin/tachibridge.jar'

EXPOSE 3737

CMD ["/usr/local/bin/mangarr-startup"]
