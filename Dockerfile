# ==========================================
# ЭТАП 1: Сборка проекта
# ==========================================
FROM ubuntu:24.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

# Убираем libspdlog-dev, оставляем только базу
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    git \
    libcurl4-openssl-dev \
    libsqlite3-dev \
    libssl-dev \
    nlohmann-json3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

RUN mkdir build && cd build && \
    cmake -DCMAKE_BUILD_TYPE=Release .. && \
    make -j$(nproc)

# ==========================================
# ЭТАП 2: Запуск
# ==========================================
FROM ubuntu:24.04

RUN apt-get update && apt-get install -y \
    libcurl4 \
    libsqlite3-0 \
    libssl3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/build/ClashBot .
COPY --from=builder /app/src/database/migrations ./migrations

RUN mkdir -p /app/data /app/logs

ENTRYPOINT ["./ClashBot"]
CMD ["config.json"]
