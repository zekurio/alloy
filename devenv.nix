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
in
{
  imports = lib.optional (builtins.pathExists ./devenv.local.nix) ./devenv.local.nix;

  # Avoid blocking shell startup on optional Cachix metadata checks. Nix's
  # configured substituters are still used for actual builds.
  cachix.enable = false;

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
  packages = with pkgs; [
    postgresql_17
    cargo
    rustc
    rustfmt
    clippy
    # NixOS-patched Electron for the desktop app. The npm `electron` package is
    # kept only for its TypeScript types (its prebuilt binary can't run on NixOS
    # without an FHS shim), so the runtime comes from here instead. Major must
    # track the npm `electron` devDependency in packages/desktop.
    electron_42
  ] ++ nativeLibs;

  # Single source of truth for the static dev environment.
  env = {
    LD_LIBRARY_PATH = lib.makeLibraryPath nativeLibs;
    NODE_ENV = "development";
    PORT = "2552";
    PUBLIC_SERVER_URL = "http://localhost:2552";
    # Dev serves the web app from Vite (5173); the server adds its own public
    # origin to the trusted set on top of this.
    TRUSTED_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173";
    ALLOY_VIEWER_COOKIE_SECRET = "dev-viewer-cookie-secret-32-bytes-min";
    ALLOY_UPLOAD_HMAC_SECRET = "dev-upload-hmac-secret-32-bytes-min";
    ALLOY_OPEN_REGISTRATIONS = "false";
    ALLOY_PASSKEY_ENABLED = "true";
    ALLOY_REQUIRE_AUTH_TO_BROWSE = "true";
    ALLOY_UPLOAD_TTL_SEC = "900";
    ALLOY_STORAGE_DRIVER = "fs";
    ALLOY_STORAGE_FS_CLIPS_PATH = "${config.devenv.root}/data/storage/clips";
    ALLOY_STORAGE_FS_USERS_PATH = "${config.devenv.root}/data/storage/users";

    # Desktop app: run the Nix-provided Electron (electron-vite reads
    # ELECTRON_EXEC_PATH) and skip the npm package's unusable binary download.
    ELECTRON_EXEC_PATH = "${pkgs.electron_42}/bin/electron";
    ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
  };

  # Start one repo-local postgres for all active shells. It listens on a
  # random free localhost port picked at startup (never colliding with a
  # system-wide Postgres service); the port is persisted in the shared env
  # file and exported as DATABASE_URL, which takes precedence over the repo
  # `.env`.
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

    # Pick a random free localhost port. The bind race between probe and
    # pg_ctl is theoretical for a dev shell; pg_ctl fails loudly if lost.
    alloy_pg_pick_port() {
      while :; do
        # $RANDOM is 0..32767, so this probes within 20000..52767.
        alloy_pg_candidate=$((20000 + RANDOM))
        if ! (exec 3<>"/dev/tcp/127.0.0.1/$alloy_pg_candidate") 2>/dev/null; then
          printf '%s\n' "$alloy_pg_candidate"
          return 0
        fi
      done
    }

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

      alloy_pg_port="$(alloy_pg_pick_port)"

      if [ ! -s "$alloy_pg_data/PG_VERSION" ]; then
        initdb \
          -D "$alloy_pg_data" \
          -U "$alloy_pg_user" \
          --auth=trust \
          --no-locale \
          >/dev/null
      fi

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
        printf 'DATABASE_URL=postgres://postgres@127.0.0.1:%s/alloy\n' "$alloy_pg_port"
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
