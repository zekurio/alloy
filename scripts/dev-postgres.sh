#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

apply_database_url() {
  if [ -z "${DATABASE_URL:-}" ]; then
    return
  fi

  local parsed
  if ! parsed="$(
    deno eval --ext=ts "$(cat <<'TS'
const raw = Deno.env.get("DATABASE_URL") ?? "";
let url: URL;

try {
  url = new URL(raw);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Invalid DATABASE_URL: ${message}`);
  Deno.exit(1);
}

if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
  console.error("DATABASE_URL must use postgres:// or postgresql://.");
  Deno.exit(1);
}

const values = [
  url.hostname.replace(/^\[(.*)\]$/, "$1") || "127.0.0.1",
  url.port || "5432",
  decodeURIComponent(url.username || "postgres"),
  decodeURIComponent(url.pathname.replace(/^\/+/, "")) || "postgres",
];

for (const value of values) {
  if (/[\r\n]/.test(value)) {
    console.error("DATABASE_URL components must not contain newlines.");
    Deno.exit(1);
  }
  console.log(value);
}
TS
)"
  )"; then
    exit 1
  fi

  local -a fields
  mapfile -t fields <<<"$parsed"
  if [ "${#fields[@]}" -ne 4 ]; then
    echo "Could not parse DATABASE_URL." >&2
    exit 1
  fi

  PGHOST="${fields[0]}"
  PGPORT="${fields[1]}"
  PGUSER="${fields[2]}"
  PGDATABASE="${fields[3]}"
}

validate_port() {
  local name="$1"
  local value="$2"

  if [[ ! "$value" =~ ^[0-9]+$ ]] || ((value < 1 || value > 65535)); then
    echo "$name must be a TCP port number between 1 and 65535." >&2
    exit 1
  fi
}

PGROOT="${PGROOT:-$ROOT_DIR/.pg}"
PGDATA="${PGDATA:-$PGROOT/data}"
PGSOCKETDIR="${PGSOCKETDIR:-$PGROOT/sockets}"
PG_MAJOR="${PG_MAJOR:-17}"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGDATABASE="${PGDATABASE:-alloy}"
DATABASE_URL="${DATABASE_URL:-postgres://$PGUSER@$PGHOST:$PGPORT/$PGDATABASE}"

apply_database_url
validate_port PGPORT "$PGPORT"

export PGROOT PGDATA PGSOCKETDIR PG_MAJOR PGHOST PGPORT PGUSER PGDATABASE DATABASE_URL

DEV_PG_LOCK_HELD=0

usage() {
  echo "Usage: $0 <start|stop|status>"
}

require_bin() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required binary: $1" >&2
    echo "Enter the dev shell first so the PostgreSQL tools are on PATH." >&2
    exit 1
  fi
}

require_bins() {
  require_bin createdb
  require_bin initdb
  require_bin pg_ctl
  require_bin pg_isready
  require_bin psql
}

ensure_layout() {
  mkdir -p "$PGROOT" "$PGSOCKETDIR"
}

release_lock() {
  if [ "$DEV_PG_LOCK_HELD" = "1" ]; then
    flock -u 9 || true
    exec 9>&-
    DEV_PG_LOCK_HELD=0
  fi
}

prepare_data_dir() {
  exec 9>"$PGROOT/.setup.lock"
  DEV_PG_LOCK_HELD=1
  flock 9

  if [ -f "$PGDATA/PG_VERSION" ]; then
    current_pg_major="$(cat "$PGDATA/PG_VERSION")"
    if [ "$current_pg_major" != "$PG_MAJOR" ] && [ -d "$PGDATA" ]; then
      backup_dir="$PGROOT/data-pg$current_pg_major-$(date +%Y%m%d%H%M%S)"
      mv "$PGDATA" "$backup_dir"
      echo "Moved incompatible PostgreSQL data dir to $backup_dir"
    fi
  fi

  if [ ! -d "$PGDATA/base" ]; then
    rm -rf "$PGDATA"
    initdb -D "$PGDATA" -U "$PGUSER" --auth-host=trust --auth-local=trust >/dev/null
  fi
}

wait_for_ready() {
  echo "Waiting for PostgreSQL on $PGHOST:$PGPORT..."
  for _ in $(seq 1 20); do
    if pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" >/dev/null 2>&1; then
      return 0
    fi

    sleep 1
  done

  echo "PostgreSQL did not become ready on $PGHOST:$PGPORT" >&2
  exit 1
}

ensure_database() {
  if ! database_exists; then
    if ! createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -- "$PGDATABASE"; then
      if ! database_exists; then
        exit 1
      fi
    fi
  fi
}

database_exists() {
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 -v dbname="$PGDATABASE" -Atq <<'SQL' | grep -qx 1
SELECT 1 FROM pg_database WHERE datname = :'dbname';
SQL
}

start_db() {
  prepare_data_dir

  if pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
    echo "PostgreSQL is already running."
  else
    release_lock

    if ! pg_ctl \
      -D "$PGDATA" \
      -l "$PGROOT/logfile" \
      -o "-p $PGPORT -h $PGHOST -k $PGSOCKETDIR" \
      start >/dev/null; then
      if ! pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
        echo "Failed to start PostgreSQL. See $PGROOT/logfile" >&2
        exit 1
      fi
    fi
  fi

  release_lock

  wait_for_ready
  ensure_database
  echo "PostgreSQL is ready at $PGHOST:$PGPORT ($PGDATABASE)."
}

stop_db() {
  if pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
    pg_ctl -D "$PGDATA" stop
  else
    echo "PostgreSQL is not running."
  fi
}

status_db() {
  if pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
    pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER"
  else
    echo "PostgreSQL is not running."
    exit 1
  fi
}

main() {
  require_bins
  ensure_layout

  case "${1:-}" in
    start)
      start_db
      ;;
    stop)
      stop_db
      ;;
    status)
      status_db
      ;;
    *)
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
