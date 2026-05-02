#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

PGROOT="${PGROOT:-$ROOT_DIR/.pg}"
PGDATA="${PGDATA:-$PGROOT/data}"
PGSOCKETDIR="${PGSOCKETDIR:-$PGROOT/sockets}"
PG_MAJOR="${PG_MAJOR:-17}"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGDATABASE="${PGDATABASE:-alloy}"
DATABASE_URL="${DATABASE_URL:-postgres://$PGUSER@$PGHOST:$PGPORT/$PGDATABASE}"

export PGROOT PGDATA PGSOCKETDIR PG_MAJOR PGHOST PGPORT PGUSER PGDATABASE DATABASE_URL

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
  if [ -e "/proc/$$/fd/9" ]; then
    flock -u 9 || true
    exec 9>&-
  fi
}

prepare_data_dir() {
  exec 9>"$PGROOT/.setup.lock"
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
  if ! psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -Atqc \
    "SELECT 1 FROM pg_database WHERE datname = '$PGDATABASE'" | grep -q 1; then
    if ! createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$PGDATABASE"; then
      if ! psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -Atqc \
        "SELECT 1 FROM pg_database WHERE datname = '$PGDATABASE'" | grep -q 1; then
        exit 1
      fi
    fi
  fi
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
