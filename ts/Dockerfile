# ==========================================
# ЭТАП 1: Сборка TypeScript и нативных модулей
# ==========================================
FROM node:24-slim AS builder

ARG DEBIAN_FRONTEND=noninteractive

# Инструменты сборки нативных аддонов (better-sqlite3 / node-gyp)
RUN apt-get update && apt-get install --no-install-recommends -y \
    python3 \
    make \
    g++ \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@12.21.0

WORKDIR /app/ts

COPY ts/package.json ts/pnpm-lock.yaml ts/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY ts/tsconfig.json ts/tsconfig.build.json ./
COPY ts/src ./src
RUN pnpm build && pnpm prune --prod

# ==========================================
# ЭТАП 2: Запуск
# ==========================================
FROM node:24-slim AS runtime

LABEL org.opencontainers.image.source="https://github.com/Flacicz/ClashBot" \
      org.opencontainers.image.description="ClashBot — autonomous Clash of Clans clan monitoring bot (TypeScript)"

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install --no-install-recommends -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

WORKDIR /app

COPY --from=builder /app/ts/package.json ./package.json
COPY --from=builder /app/ts/node_modules ./node_modules
COPY --from=builder /app/ts/dist ./dist
COPY src/database/migrations ./migrations
COPY resources/telegram/attack_guides.json ./resources/telegram/attack_guides.json

RUN mkdir -p /app/data /app/logs

ENTRYPOINT ["node", "dist/cli.js"]
CMD ["config.json"]
