#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[alloy-aio] %s\n' "$*"
}

generate_secret() {
  openssl rand -base64 32 | tr -d '\n'
}

export ALLOY_DATA_DIR="${ALLOY_DATA_DIR:-/data}"
export PGDATA="${PGDATA:-$ALLOY_DATA_DIR/postgres}"
export STORAGE_FS_ROOT="${STORAGE_FS_ROOT:-$ALLOY_DATA_DIR/storage}"

secrets_file="$ALLOY_DATA_DIR/secrets.env"
if [[ -f "$secrets_file" && -z "${BETTER_AUTH_SECRET:-}" ]]; then
  BETTER_AUTH_SECRET="$(
    source "$secrets_file"
    printf '%s' "${BETTER_AUTH_SECRET:-}"
  )"
fi
if [[ -f "$secrets_file" && -z "${STORAGE_HMAC_SECRET:-}" ]]; then
  STORAGE_HMAC_SECRET="$(
    source "$secrets_file"
    printf '%s' "${STORAGE_HMAC_SECRET:-}"
  )"
fi

export POSTGRES_DB="${POSTGRES_DB:-alloy}"
export POSTGRES_USER="${POSTGRES_USER:-alloy}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-alloy}"
export PGPASSWORD="$POSTGRES_PASSWORD"

mkdir -p "$ALLOY_DATA_DIR" "$PGDATA" "$STORAGE_FS_ROOT" "$ALLOY_DATA_DIR/encode"
chown -R postgres:postgres "$PGDATA"

PG_BIN="$(dirname "$(find /usr/lib/postgresql -path '*/bin/pg_ctl' -print -quit)")"
if [[ ! -x "$PG_BIN/pg_ctl" ]]; then
  log "could not find pg_ctl under /usr/lib/postgresql"
  exit 1
fi
export PATH="$PG_BIN:$PATH"

if [[ -z "${BETTER_AUTH_SECRET:-}" ]]; then
  BETTER_AUTH_SECRET="$(generate_secret)"
  printf 'export BETTER_AUTH_SECRET=%q\n' "$BETTER_AUTH_SECRET" >> "$secrets_file"
fi
if [[ -z "${STORAGE_HMAC_SECRET:-}" ]]; then
  STORAGE_HMAC_SECRET="$(generate_secret)"
  printf 'export STORAGE_HMAC_SECRET=%q\n' "$STORAGE_HMAC_SECRET" >> "$secrets_file"
fi
export BETTER_AUTH_SECRET STORAGE_HMAC_SECRET

if [[ ! -s "$PGDATA/PG_VERSION" ]]; then
  log "initializing postgres data directory"
  pwfile="$(mktemp)"
  printf '%s\n' "$POSTGRES_PASSWORD" > "$pwfile"
  chown postgres:postgres "$pwfile"
  runuser -u postgres -- initdb -D "$PGDATA" --username="$POSTGRES_USER" --pwfile="$pwfile"
  rm -f "$pwfile"
  {
    printf "listen_addresses = '127.0.0.1'\n"
    printf "port = 5432\n"
  } >> "$PGDATA/postgresql.conf"
  chown postgres:postgres "$PGDATA/postgresql.conf"
fi

log "starting postgres"
runuser -u postgres -- pg_ctl -D "$PGDATA" -w start

cleanup() {
  log "stopping services"
  jobs -pr | xargs -r kill
  runuser -u postgres -- pg_ctl -D "$PGDATA" -m fast -w stop || true
}
trap cleanup EXIT INT TERM

if ! psql -h 127.0.0.1 -U "$POSTGRES_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB'" | grep -q 1; then
  log "creating postgres database $POSTGRES_DB"
  createdb -h 127.0.0.1 -U "$POSTGRES_USER" "$POSTGRES_DB"
fi

export DATABASE_URL="${DATABASE_URL:-postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@127.0.0.1:5432/$POSTGRES_DB}"
export VITE_SERVER_URL="${VITE_SERVER_URL:-http://localhost:3000}"
export PUBLIC_APP_URL="${PUBLIC_APP_URL:-http://localhost:8080}"
export PUBLIC_SERVER_URL="${PUBLIC_SERVER_URL:-$VITE_SERVER_URL}"
export TRUSTED_ORIGINS="${TRUSTED_ORIGINS:-$PUBLIC_APP_URL}"
export STORAGE_DRIVER="${STORAGE_DRIVER:-fs}"
export STORAGE_PUBLIC_BASE_URL="${STORAGE_PUBLIC_BASE_URL:-$PUBLIC_SERVER_URL}"
export RUNTIME_CONFIG_PATH="${RUNTIME_CONFIG_PATH:-$ALLOY_DATA_DIR/runtime-config.json}"
export ENCODE_SCRATCH_DIR="${ENCODE_SCRATCH_DIR:-$ALLOY_DATA_DIR/encode}"

log "running database migrations"
pnpm --dir /app/packages/db migrate:deploy

log "starting server"
pnpm --dir /app/apps/server exec tsx src/index.ts &
server_pid=$!

log "starting web"
PORT="${WEB_PORT:-8080}" node /app/apps/web/.output/server/index.mjs &
web_pid=$!

wait -n "$server_pid" "$web_pid"
