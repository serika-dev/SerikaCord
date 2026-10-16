#!/usr/bin/env bash
# Throwaway Postgres + Redis for the bot-compat harness, bound to 127.0.0.1
# only, data in tmpfs (gone on `down`). Never touches other containers.
#   scripts/bot-compat/stack.sh up     # start (idempotent)
#   scripts/bot-compat/stack.sh down   # remove both containers
set -euo pipefail

PG=serika-botcompat-pg
REDIS=serika-botcompat-redis

case "${1:-}" in
  up)
    if ! docker ps -a --format '{{.Names}}' | grep -qx "$PG"; then
      docker run -d --name "$PG" \
        -p 127.0.0.1:55432:5432 \
        --tmpfs /var/lib/postgresql/data:rw,size=512m \
        -e POSTGRES_USER=serika -e POSTGRES_PASSWORD=serika -e POSTGRES_DB=serika_compat \
        --memory 256m \
        postgres:17-alpine \
        -c shared_buffers=16MB -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=40 >/dev/null
    else
      docker start "$PG" >/dev/null
    fi
    if ! docker ps -a --format '{{.Names}}' | grep -qx "$REDIS"; then
      docker run -d --name "$REDIS" \
        -p 127.0.0.1:56379:6379 \
        --memory 64m \
        redis:7-alpine redis-server --save "" --appendonly no >/dev/null
    else
      docker start "$REDIS" >/dev/null
    fi
    for _ in $(seq 1 60); do
      if docker exec "$PG" pg_isready -U serika -d serika_compat >/dev/null 2>&1; then break; fi
      sleep 0.5
    done
    echo "bot-compat stack up: postgres 127.0.0.1:55432, redis 127.0.0.1:56379"
    ;;
  down)
    docker rm -f "$PG" "$REDIS" >/dev/null 2>&1 || true
    echo "bot-compat stack removed"
    ;;
  *)
    echo "usage: $0 up|down" >&2
    exit 1
    ;;
esac
