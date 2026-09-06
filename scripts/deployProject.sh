#!/usr/bin/env bash
set -e

PROJECT_PATH="/mnt/c/Code/C++/ActivityTracking"
IMAGE="clashbot:latest"
ARCHIVE="clashbot.tar"
SERVER="root@45.138.74.213"
REMOTE_DIR="/root/clashbot"
REMOTE_DOCKER_CONTAINER="clashbot"

docker build -t "$IMAGE" "$PROJECT_PATH"

docker save -o "$PROJECT_PATH/$ARCHIVE" "$IMAGE"

ssh "$SERVER" "
  mkdir -p '$REMOTE_DIR/data' '$REMOTE_DIR/logs'

  if [ ! -f '$REMOTE_DIR/config.json' ]; then
    echo 'Создаю config.json'
    touch '$REMOTE_DIR/config.json'
  else
    echo 'config.json уже существует'
  fi
"
scp "$PROJECT_PATH/$ARCHIVE" "$SERVER:$REMOTE_DIR/"

ssh "$SERVER" "docker rm -f '$REMOTE_DOCKER_CONTAINER' 2>/dev/null || true"
ssh "$SERVER" "docker load -i '$REMOTE_DIR'/'$ARCHIVE'"

ssh "$SERVER" "
  docker run -d \
     --name '$REMOTE_DOCKER_CONTAINER' \
     --restart unless-stopped \
     -v '$REMOTE_DIR/config.json:/app/config.json:ro' \
     -v '$REMOTE_DIR/data:/app/data' \
     -v '$REMOTE_DIR/logs:/app/logs' \
        '$IMAGE'
"

ssh "$SERVER" "docker ps -a"
ssh "$SERVER" "docker logs '$REMOTE_DOCKER_CONTAINER'"

ssh "$SERVER" "rm -f '$REMOTE_DIR/$ARCHIVE'"
