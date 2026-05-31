#!/usr/bin/env sh
set -eu

: "${DATABASE_URL:=postgres://postgres@localhost:5432/alloy}"
: "${NODE_ENV:=development}"
: "${PORT:=3000}"
: "${PUBLIC_SERVER_URL:=http://localhost:3000}"
: "${TRUSTED_ORIGINS:=http://localhost:5173,http://127.0.0.1:5173}"

export DATABASE_URL NODE_ENV PORT PUBLIC_SERVER_URL TRUSTED_ORIGINS

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
