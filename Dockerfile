# syntax=docker/dockerfile:1.7

ARG CONVEX_BACKEND_IMAGE=ghcr.io/get-convex/convex-backend@sha256:a2d21bddff6048eadb810a39599dee6002dfba00fbb1299f593f8586b3ccbbd9
FROM ${CONVEX_BACKEND_IMAGE} AS convex-backend

FROM node:24-alpine AS web-base
WORKDIR /app/web

ENV PNPM_HOME=/pnpm \
    PNPM_STORE_DIR=/pnpm/store

RUN corepack enable && \
    corepack prepare pnpm@10.33.4 --activate && \
    mkdir -p "${PNPM_STORE_DIR}"

COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN --mount=type=cache,id=mangarr-pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --prefer-offline


FROM web-base AS web-dev
CMD ["sh", "-c", "if [ ! -d node_modules/.pnpm ]; then pnpm install --frozen-lockfile; fi && pnpm run dev"]


FROM web-base AS web-build
COPY web/ .
RUN pnpm run build


FROM node:24-alpine AS web-runtime
WORKDIR /app/web

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3737 \
    PNPM_HOME=/pnpm \
    PNPM_STORE_DIR=/pnpm/store

RUN corepack enable && \
    corepack prepare pnpm@10.33.4 --activate && \
    mkdir -p "${PNPM_STORE_DIR}"

COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN --mount=type=cache,id=mangarr-pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --prod --prefer-offline

COPY --from=web-build /app/web/build ./build

EXPOSE 3737

CMD ["node", "build"]


FROM eclipse-temurin:21-jre AS java-runtime


FROM eclipse-temurin:21-jdk AS bridge-base
WORKDIR /app/bridge

RUN --mount=type=cache,id=mangarr-bridge-apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=mangarr-bridge-apt-lists,target=/var/lib/apt/lists,sharing=locked \
    sed -i 's|http://archive.ubuntu.com/ubuntu/|https://mirrors.edge.kernel.org/ubuntu/|g; s|https://archive.ubuntu.com/ubuntu/|https://mirrors.edge.kernel.org/ubuntu/|g; s|http://security.ubuntu.com/ubuntu/|https://security.ubuntu.com/ubuntu/|g' /etc/apt/sources.list.d/ubuntu.sources && \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    printf 'Binary::apt::APT::Keep-Downloaded-Packages "true";\n' >/etc/apt/apt.conf.d/keep-cache && \
    apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends curl zip ca-certificates

COPY bridge/gradlew /app/bridge/gradlew
COPY bridge/gradle /app/bridge/gradle
COPY bridge/settings.gradle.kts /app/bridge/settings.gradle.kts
COPY bridge/build.gradle.kts /app/bridge/build.gradle.kts
COPY bridge/gradle.properties /app/bridge/gradle.properties
COPY bridge/AndroidCompat/build.gradle.kts /app/bridge/AndroidCompat/build.gradle.kts
COPY bridge/AndroidCompat/Config/build.gradle.kts /app/bridge/AndroidCompat/Config/build.gradle.kts
COPY bridge/app/build.gradle.kts /app/bridge/app/build.gradle.kts

RUN chmod +x ./gradlew

RUN --mount=type=cache,id=mangarr-gradle-wrapper,target=/root/.gradle/wrapper,sharing=locked \
    ./gradlew --no-daemon --version

RUN mkdir -p /app/bridge/AndroidCompat /app/bridge/AndroidCompat/Config /app/bridge/app

RUN --mount=type=cache,id=mangarr-gradle-wrapper,target=/root/.gradle/wrapper,sharing=locked \
    --mount=type=cache,id=mangarr-gradle-caches,target=/root/.gradle/caches,sharing=locked \
    --mount=type=cache,id=mangarr-gradle-project,target=/app/bridge/.gradle,sharing=locked \
    ./gradlew --no-daemon :app:dependencies >/dev/null


FROM bridge-base AS bridge-build

COPY bridge ./

RUN --mount=type=cache,id=mangarr-android-cache,target=/app/bridge/.android-cache,sharing=locked \
    bash ./AndroidCompat/getAndroid.sh

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

RUN --mount=type=cache,id=mangarr-runtime-apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=mangarr-runtime-apt-lists,target=/var/lib/apt/lists,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    printf 'Binary::apt::APT::Keep-Downloaded-Packages "true";\n' >/etc/apt/apt.conf.d/keep-cache && \
    corepack enable && \
    corepack prepare pnpm@10.33.4 --activate && \
    apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends curl ca-certificates tini dbus dbus-x11 \
      libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 \
      libexpat1 libfontconfig1 libgbm1 libgl1 libgl1-mesa-dri libglib2.0-0 \
      libgluegen2-jni libgtk-3-0 libnspr4 libnss3 libjogl2-jni \
      libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 \
      libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxkbcommon0 \
      libxrandr2 libxtst6 xvfb && \
    ln -sf /opt/java/openjdk/lib/server/libjvm.so /usr/lib/libjvm.so

COPY --from=convex-backend /convex /app/convex

COPY scripts/runtime-supervisor.mjs /app/scripts/runtime-supervisor.mjs
RUN chmod +x /app/scripts/runtime-supervisor.mjs

ENTRYPOINT ["tini", "--"]

FROM mangarr-base AS mangarr-dev
ENV MANGARR_APP_MODE=dev
RUN mkdir -p /app/bin /app/config /app/downloads /app/web
COPY --from=bridge-build /app/bridge/app/build/tachibridge-*.jar /app/bin/
RUN sh -c 'jar=$(echo /app/bin/tachibridge-*.jar); cp "$jar" /app/bin/tachibridge.jar'

EXPOSE 3737

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=5 CMD \
  curl -fsS "http://127.0.0.1:${PORT:-3737}/login" >/dev/null && \
  curl -fsS "http://127.0.0.1:${MANGARR_BRIDGE_PORT:-3212}/health" >/dev/null || exit 1

CMD ["node", "/app/scripts/runtime-supervisor.mjs"]


FROM mangarr-base AS mangarr-runtime
ENV MANGARR_APP_MODE=prod \
    PNPM_HOME=/pnpm \
    PNPM_STORE_DIR=/pnpm/store

WORKDIR /app/web
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN mkdir -p "${PNPM_STORE_DIR}" && \
    corepack enable
RUN --mount=type=cache,id=mangarr-pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --prod --prefer-offline
COPY web/convex.json /app/web/convex.json
COPY web/server.js /app/web/server.js
COPY web/tsconfig.json /app/web/tsconfig.json
COPY web/src/convex /app/web/src/convex
COPY web/src/lib/server/logging.js /app/web/src/lib/server/logging.js
COPY web/src/lib/utils /app/web/src/lib/utils
COPY web/src/lib/server/convex-auth-config.ts /app/web/src/lib/server/convex-auth-config.ts
COPY --from=web-build /app/web/build /app/web/build
COPY --from=web-build /app/web/.svelte-kit/tsconfig.json /app/web/.svelte-kit/tsconfig.json

WORKDIR /app
RUN mkdir -p /app/bin /app/config /app/downloads
COPY --from=bridge-build /app/bridge/app/build/tachibridge-*.jar /app/bin/
RUN sh -c 'jar=$(echo /app/bin/tachibridge-*.jar); cp "$jar" /app/bin/tachibridge.jar'

EXPOSE 3737

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=5 CMD \
  curl -fsS "http://127.0.0.1:${PORT:-3737}/login" >/dev/null && \
  curl -fsS "http://127.0.0.1:${MANGARR_BRIDGE_PORT:-3212}/health" >/dev/null || exit 1

CMD ["node", "/app/scripts/runtime-supervisor.mjs"]
