#!/usr/bin/env bash
# Repo-local Postgres shared by every devenv shell. `start` reuses the running
# server or starts one on a random free localhost port, then writes PGHOST,
# PGPORT and DATABASE_URL to $env_file for enterShell to source. `stop` shuts
# it down.
set -eu

data="$DEVENV_ROOT/.devenv/state/alloy-postgres"
run="$DEVENV_ROOT/.devenv/run/postgres"
env_file="$run/env"
pid_file="$run/postgres.pid"
db=alloy
user=postgres

write_env() {
  sed -n '1p' "$data/postmaster.pid" >"$pid_file"
  {
    printf 'PGHOST=127.0.0.1\n'
    printf 'PGPORT=%s\n' "$1"
    printf 'DATABASE_URL=postgres://postgres@127.0.0.1:%s/alloy\n' "$1"
  } >"$env_file"
}

# Pick a random free localhost port. The bind race between probe and pg_ctl
# is theoretical for a dev shell; pg_ctl fails loudly if lost.
pick_port() {
  while :; do
    # $RANDOM is 0..32767, so this probes within 20000..52767.
    candidate=$((20000 + RANDOM))
    if ! (exec 3<>"/dev/tcp/127.0.0.1/$candidate") 2>/dev/null; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
}

# The server recorded in $env_file is alive and accepting connections.
ready() {
  [ -f "$env_file" ] || return 1
  # shellcheck source=/dev/null
  . "$env_file"
  [ -n "${PGPORT:-}" ] || return 1
  pid="$(
    cat "$pid_file" 2>/dev/null ||
      sed -n '1p' "$data/postmaster.pid" 2>/dev/null ||
      true
  )"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" >/dev/null 2>&1 || return 1
  pg_isready -h "${PGHOST:-127.0.0.1}" -p "$PGPORT" -U "$user" -d "$db" \
    >/dev/null 2>&1
}

# A server is running without a usable $env_file; rewrite it from
# postmaster.pid instead of starting a second one.
recover_running() {
  [ -s "$data/postmaster.pid" ] || return 1
  pid="$(sed -n '1p' "$data/postmaster.pid")"
  port="$(sed -n '4p' "$data/postmaster.pid")"
  [ -n "$pid" ] || return 1
  [ -n "$port" ] || return 1
  kill -0 "$pid" >/dev/null 2>&1 || return 1
  pg_isready -h 127.0.0.1 -p "$port" -U "$user" -d "$db" >/dev/null 2>&1 ||
    return 1
  write_env "$port"
}

start() {
  mkdir -p "$data" "$run"

  # Serialize startup across shells. The lock is released when this script
  # exits, so nothing started below may inherit fd 9.
  exec 9>"$run/lock"
  if ! flock -w 30 9; then
    echo "Timed out waiting for Alloy dev Postgres startup lock" >&2
    echo "If no other shell is starting, run alloy-postgres-stop and try again." >&2
    exit 1
  fi

  if ready || recover_running; then
    return 0
  fi
  rm -f "$env_file"

  port="$(pick_port)"

  if [ ! -s "$data/PG_VERSION" ]; then
    initdb -D "$data" -U "$user" --auth=trust --no-locale >/dev/null 9>&-
  fi

  # direnv captures hook output on extra file descriptors. Close them for the
  # daemon starter so Postgres cannot keep `direnv export` alive.
  pg_ctl \
    -D "$data" \
    -l "$run/postgres.log" \
    -o "-h 127.0.0.1 -p $port -k $run" \
    -w \
    -t 30 \
    start \
    >/dev/null \
    3>&- \
    4>&- \
    5>&- \
    6>&- \
    7>&- \
    8>&- \
    9>&-

  write_env "$port"

  createdb -h 127.0.0.1 -p "$port" -U "$user" "$db" >/dev/null 2>&1 9>&- ||
    true
}

stop() {
  if [ -s "$data/PG_VERSION" ]; then
    pg_ctl -D "$data" -w stop >/dev/null
  fi
  rm -f "$env_file" "$pid_file"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  *)
    echo "usage: alloy-postgres start|stop" >&2
    exit 2
    ;;
esac
