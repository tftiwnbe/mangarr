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

RUN ./gradlew --no-daemon shadowJar && \
    echo "JAR files built:" && ls -la /app/bridge/app/build/*.jar


FROM python:3.13-slim AS runtime
ARG TARGETARCH
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN mkdir -p /app/config/bin /app/bin
RUN mkdir -p /opt/kcef/jcef

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    openjdk-21-jre \
    libx11-6 libxext6 libxrender1 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libxkbcommon0 \
    libxcb1 libx11-xcb1 libxss1 libxtst6 libxi6 \
    libgbm1 libexpat1 libdrm2 \
    libglib2.0-0 libgobject-2.0-0 libgio-2.0-0 \
    libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 \
    libcups2 libpango-1.0-0 libcairo2 libasound2 \
    libdbus-1-3 libnss3 \
    libjogl2-jni libgluegen2-jni \
    xvfb xauth && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix && \
    if [ -f /usr/lib/jni/libgluegen2_rt.so ]; then ln -sf /usr/lib/jni/libgluegen2_rt.so /usr/lib/jni/libgluegen_rt.so; fi

RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir uv

ENV UV_LINK_MODE=copy
ENV JAVA_HOME=/usr/lib/jvm/java-21-openjdk-${TARGETARCH}
ENV LD_LIBRARY_PATH=$JAVA_HOME/lib/server:$JAVA_HOME/lib
ENV KCEF_INSTALL_DIR=/opt/kcef/jcef

COPY server/pyproject.toml server/uv.lock /app/server/
WORKDIR /app/server
RUN uv sync --frozen --no-dev

COPY server /app/server
COPY --from=frontend-build /app/server/app/static /app/server/app/static
COPY --from=bridge-build /app/bridge/app/build/tachibridge-*.jar /app/bin/

RUN echo "Verifying JAR file:" && ls -la /app/bin/*.jar

EXPOSE 3737

CMD ["uv", "run", "--frozen", "--no-dev", "python", "-m", "app.main"]
