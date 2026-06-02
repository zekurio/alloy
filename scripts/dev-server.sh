#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

: "${ALLOY_CONFIG_FILE:=$ROOT_DIR/data/server/runtime-config.json}"
: "${ALLOY_STORAGE_DIR:=$ROOT_DIR/data/server/storage}"
: "${DATABASE_URL:=postgres://postgres@127.0.0.1:5432/alloy}"
: "${ENCODE_SCRATCH_DIR:=$ROOT_DIR/data/server/scratch}"
: "${MACHINE_LEARNING_ENABLED:=1}"
: "${MACHINE_LEARNING_URL:=http://localhost:2662}"
: "${NODE_ENV:=development}"
: "${PORT:=2552}"
: "${PUBLIC_SERVER_URL:=http://localhost:$PORT}"
: "${TRUSTED_ORIGINS:=http://localhost:5173,http://127.0.0.1:5173}"

export ALLOY_CONFIG_FILE ALLOY_STORAGE_DIR DATABASE_URL ENCODE_SCRATCH_DIR
export MACHINE_LEARNING_ENABLED
export MACHINE_LEARNING_URL NODE_ENV PORT PUBLIC_SERVER_URL TRUSTED_ORIGINS

exec deno run \
  --watch \
  --no-clear-screen \
  --allow-env \
  --allow-net \
  --allow-read \
  --allow-write \
  --allow-run \
  --allow-ffi \
  src/index.ts
