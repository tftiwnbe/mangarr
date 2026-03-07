FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

ARG DEBIAN_FRONTEND=noninteractive
ARG NODE_MAJOR=20

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    git \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libgbm1 \
    libgdk-pixbuf-2.0-0 \
    libgio-2.0-0 \
    libglib2.0-0 \
    libgluegen2-jni \
    libgobject-2.0-0 \
    libgtk-3-0 \
    libjogl2-jni \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxkbcommon0 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    netcat-openbsd \
    openjdk-21-jdk-headless \
    unzip \
    xauth \
    xvfb \
    zip && \
    rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - && \
    apt-get update && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/* && \
    corepack enable && \
    corepack prepare pnpm@latest --activate

RUN curl -LsSf https://astral.sh/uv/install.sh | sh && \
    install -m 0755 /root/.local/bin/uv /usr/local/bin/uv && \
    install -m 0755 /root/.local/bin/uvx /usr/local/bin/uvx

RUN curl -fsSL https://just.systems/install.sh | bash -s -- --to /usr/local/bin

ENV JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
ENV PATH=/home/vscode/.local/bin:${PATH}

RUN mkdir -p /workspaces/mangarr/config/bin /workspaces/mangarr/data && \
    chown -R vscode:vscode /workspaces/mangarr
