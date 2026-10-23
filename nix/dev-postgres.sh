#!/usr/bin/env bash
# Repo-local Postgres shared by every devenv shell. It listens only on a Unix
# socket under devenv's runtime directory, so DATABASE_URL and PGHOST are
# static values from devenv.nix and nothing can collide with a system-wide
# Postgres. `start` reuses the running server or starts one; `stop` shuts it
# down.
set -eu

data="$DEVENV_ROOT/.devenv/state/alloy-postgres"
# Must match postgresSocketDir in devenv.nix.
run="$DEVENV_RUNTIME/postgres"
db=alloy
user=postgres

# The server accepts connections on the socket.
ready() {
  pg_isready -h "$run" -U "$user" -d "$db" >/dev/null 2>&1
}

# A server from this data directory is alive, reachable or not.
running() {
  [ -s "$data/postmaster.pid" ] || return 1
  pid="$(sed -n '1p' "$data/postmaster.pid")"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" >/dev/null 2>&1
}

start() {
  # The socket, lock and log are private to this user: the cluster trusts
  # every connection.
  mkdir -p "$data" "$run"
  chmod 700 "$run"

  # Serialize startup across shells. The lock is released when this script
  # exits, so nothing started below may inherit fd 9.
  exec 9>"$run/lock"
  if ! flock -w 30 9; then
    echo "Timed out waiting for Alloy dev Postgres startup lock" >&2
    echo "If no other shell is starting, run alloy-postgres-stop and try again." >&2
    exit 1
  fi

  if ready; then
    return 0
  fi
  # Alive but not on our socket, e.g. started by an older version of this
  # script on a TCP port: restart it with the current options.
  if running; then
    pg_ctl -D "$data" -w stop >/dev/null
  fi

  if [ ! -s "$data/PG_VERSION" ]; then
    initdb -D "$data" -U "$user" --auth=trust --no-locale >/dev/null 9>&-
  fi

  # No TCP listener. direnv captures hook output on extra file descriptors:
  # close them for the daemon starter so Postgres cannot keep `direnv export`
  # alive.
  pg_ctl \
    -D "$data" \
    -l "$run/postgres.log" \
    -o "-c listen_addresses='' -c unix_socket_directories='$run' -c unix_socket_permissions=0700" \
    -w \
    -t 30 \
    start \
    >/dev/null \
    3>&- 4>&- 5>&- 6>&- 7>&- 8>&- 9>&-

  createdb -h "$run" -U "$user" "$db" >/dev/null 2>&1 9>&- || true
}

stop() {
  if running; then
    pg_ctl -D "$data" -w stop >/dev/null
  fi
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  *)
    echo "usage: alloy-postgres start|stop" >&2
    exit 2
    ;;
esac
