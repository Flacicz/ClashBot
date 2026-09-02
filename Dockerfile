# ==========================================
# ЭТАП 1: Сборка проекта
# ==========================================
FROM ubuntu:24.04 AS builder

ARG DEBIAN_FRONTEND=noninteractive
ARG VCPKG_COMMIT=cc73782a88db48af17f8bfb8328d4cab3d4c246f

# Системные инструменты для сборки проекта и зависимостей vcpkg
RUN apt-get update && apt-get install --no-install-recommends -y \
    build-essential \
    ca-certificates \
    cmake \
    curl \
    git \
    pkg-config \
    tar \
    unzip \
    zip \
    && rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/microsoft/vcpkg.git /opt/vcpkg && \
    git -C /opt/vcpkg checkout "$VCPKG_COMMIT" && \
    /opt/vcpkg/bootstrap-vcpkg.sh -disableMetrics

WORKDIR /app

COPY vcpkg.json ./
RUN /opt/vcpkg/vcpkg install \
        --triplet=x64-linux \
        --x-manifest-root=/app \
        --x-install-root=/opt/vcpkg_installed

COPY CMakeLists.txt ./
COPY include ./include
COPY src ./src
COPY tests ./tests
COPY resources ./resources

RUN cmake -S . -B build \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_TOOLCHAIN_FILE=/opt/vcpkg/scripts/buildsystems/vcpkg.cmake \
        -DVCPKG_INSTALLED_DIR=/opt/vcpkg_installed && \
    cmake --build build --parallel && \
    ctest --test-dir build --output-on-failure

# ==========================================
# ЭТАП 2: Запуск
# ==========================================
FROM ubuntu:24.04 AS runtime

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install --no-install-recommends -y \
    ca-certificates \
    libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/build/ClashBot .
COPY --from=builder /app/src/database/migrations ./migrations
COPY --from=builder /app/resources ./resources

RUN mkdir -p /app/data /app/logs

ENTRYPOINT ["./ClashBot"]
CMD ["config.json"]
