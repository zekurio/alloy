{
  pkgs,
  lib,
  config,
  ...
}:
let
  # Native libraries npm deps may dlopen at dev time. Mirrors the packaged
  # server's runtime library assumptions in nix/package.nix.
  nativeLibs = with pkgs; [
    stdenv.cc.cc.lib
    zlib
    zstd
  ];
  dataDir = "${config.devenv.root}/data";
in
{
  # https://devenv.sh/languages/
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_24;
    pnpm = {
      enable = true;
      package = pkgs.pnpm;
    };
  };

  # https://devenv.sh/packages/
  # The machine-learning service owns its own uv-managed venv under
  # machine-learning/.venv. devenv only provides Python and uv so it does not
  # fight that project-local environment.
  packages = with pkgs; [
    python311
    uv
    postgresql_17
    jellyfin-ffmpeg
    imagemagick
    cargo
    rustc
    rustfmt
    clippy
    # NixOS-patched Electron for the desktop app. The npm `electron` package is
    # kept only for its TypeScript types (its prebuilt binary can't run on NixOS
    # without an FHS shim), so the runtime comes from here instead. Major must
    # track the npm `electron` devDependency in apps/desktop.
    electron_42
  ] ++ nativeLibs;

  # Single source of truth for the static dev environment.
  env = {
    LD_LIBRARY_PATH = lib.makeLibraryPath nativeLibs;
    NODE_ENV = "development";
    PORT = "2552";
    PUBLIC_SERVER_URL = "http://localhost:2552";
    MACHINE_LEARNING_ENABLED = "1";
    # Dev serves the web app from Vite (5173); the server adds its own public
    # origin to the trusted set on top of this.
    TRUSTED_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173";
    ALLOY_DATA_DIR = dataDir;
    ALLOY_CLIPS_DIR = "${dataDir}/clips";
    ALLOY_ENCODE_DIR = "${dataDir}/encode";
    ALLOY_ML_HOST = "0.0.0.0";
    ALLOY_ML_PORT = "2662";
    MACHINE_LEARNING_CACHE_FOLDER = "${dataDir}/ml";

    # Desktop app: run the Nix-provided Electron (electron-vite reads
    # ELECTRON_EXEC_PATH) and skip the npm package's unusable binary download.
    ELECTRON_EXEC_PATH = "${pkgs.electron_42}/bin/electron";
    ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
  };

  # Start one repo-local postgres for all active shells. It listens on a random
  # localhost port, then exports DATABASE_URL for the current shell/direnv load.
  enterShell = ''
    alloy_had_errexit=0
    alloy_had_nounset=0
    case "$-" in
      *e*) alloy_had_errexit=1 ;;
    esac
    case "$-" in
      *u*) alloy_had_nounset=1 ;;
    esac
    set -eu

    alloy_pg_root="${config.devenv.root}/.devenv"
    alloy_pg_data="$alloy_pg_root/state/alloy-postgres"
    alloy_pg_run="$alloy_pg_root/run/postgres"
    alloy_pg_env="$alloy_pg_run/env"
    alloy_pg_lock="$alloy_pg_run/lock"
    alloy_pg_log="$alloy_pg_run/postgres.log"
    alloy_pg_pid="$alloy_pg_run/postgres.pid"
    alloy_pg_db="alloy"
    alloy_pg_user="postgres"
    alloy_flock="${pkgs.util-linuxMinimal}/bin/flock"

    mkdir -p "$alloy_pg_data" "$alloy_pg_run"

    alloy_pg_ready() {
      [ -f "$alloy_pg_env" ] || return 1
      . "$alloy_pg_env"
      [ -n "''${PGPORT:-}" ] || return 1
      alloy_pg_existing_pid="$(
        cat "$alloy_pg_pid" 2>/dev/null ||
          sed -n '1p' "$alloy_pg_data/postmaster.pid" 2>/dev/null ||
          true
      )"
      [ -n "$alloy_pg_existing_pid" ] || return 1
      kill -0 "$alloy_pg_existing_pid" >/dev/null 2>&1 || return 1
      pg_isready \
        -h "''${PGHOST:-127.0.0.1}" \
        -p "$PGPORT" \
        -U "$alloy_pg_user" \
        -d "$alloy_pg_db" \
        >/dev/null 2>&1
    }

    exec 9>"$alloy_pg_lock"
    "$alloy_flock" 9

    if ! alloy_pg_ready; then
      rm -f "$alloy_pg_env"

      if [ ! -s "$alloy_pg_data/PG_VERSION" ]; then
        initdb \
          -D "$alloy_pg_data" \
          -U "$alloy_pg_user" \
          --auth=trust \
          --no-locale \
          >/dev/null
      fi

      alloy_pg_port="$(python - <<'PY'
import socket

with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
PY
)"

      pg_ctl \
        -D "$alloy_pg_data" \
        -l "$alloy_pg_log" \
        -o "-h 127.0.0.1 -p $alloy_pg_port -k $alloy_pg_run" \
        -w \
        start \
        >/dev/null

      sed -n '1p' "$alloy_pg_data/postmaster.pid" >"$alloy_pg_pid"

      {
        printf 'PGHOST=127.0.0.1\n'
        printf 'PGPORT=%s\n' "$alloy_pg_port"
        printf 'DATABASE_URL=postgres://postgres@127.0.0.1:%s/alloy\n' \
          "$alloy_pg_port"
      } >"$alloy_pg_env"

      createdb \
        -h 127.0.0.1 \
        -p "$alloy_pg_port" \
        -U "$alloy_pg_user" \
        "$alloy_pg_db" \
        >/dev/null 2>&1 || true
    fi

    "$alloy_flock" -u 9
    exec 9>&-

    . "$alloy_pg_env"
    export PGHOST PGPORT DATABASE_URL
    export DRIZZLE_DATABASE_URL="$DATABASE_URL"

    if [ "$alloy_had_errexit" = 0 ]; then
      set +e
    fi
    if [ "$alloy_had_nounset" = 0 ]; then
      set +u
    fi
    unset alloy_had_errexit alloy_had_nounset

    echo "Alloy dev Postgres: $DATABASE_URL"
  '';

  scripts.alloy-postgres-stop.exec = ''
    set -eu

    alloy_pg_root="${config.devenv.root}/.devenv"
    alloy_pg_data="$alloy_pg_root/state/alloy-postgres"
    alloy_pg_run="$alloy_pg_root/run/postgres"
    alloy_pg_env="$alloy_pg_run/env"
    alloy_pg_pid="$alloy_pg_run/postgres.pid"

    if [ -s "$alloy_pg_data/PG_VERSION" ]; then
      pg_ctl -D "$alloy_pg_data" -w stop >/dev/null
    fi

    rm -f "$alloy_pg_env" "$alloy_pg_pid"
  '';

  # See full reference at https://devenv.sh/reference/options/
}
