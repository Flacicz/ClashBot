FROM ubuntu:22.04 AS builder

RUN apt-get update && apt-get install -y \
    build-essential cmake git libcurl4-openssl-dev libsqlite3-dev

WORKDIR /app
COPY . .

RUN mkdir build && cd build && \
    cmake .. && \
    make

FROM ubuntu:22.04
RUN apt-get update && apt-get install -y libcurl4 libsqlite3-0

WORKDIR /app
COPY --from=builder /app/build/ClashBot .
COPY config.json .

ENTRYPOINT ["./ClashBot", "config.json"]