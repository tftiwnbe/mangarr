# syntax=docker/dockerfile:1

FROM node:24-alpine AS web-base
WORKDIR /app/web

RUN corepack enable

COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile


FROM web-base AS web-dev
CMD ["sh", "-c", "if [ ! -d node_modules/.pnpm ]; then pnpm install --frozen-lockfile; fi && pnpm run dev --host 0.0.0.0 --port 3000"]


FROM web-base AS web-build
COPY web/ .
RUN pnpm run build


FROM node:24-alpine AS web-runtime
WORKDIR /app/web

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

RUN corepack enable

COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=web-build /app/web/build ./build

EXPOSE 3000

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
