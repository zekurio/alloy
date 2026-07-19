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
  pnpmPackage = import ./nix/pnpm.nix { inherit (pkgs) pnpm; };
in
{
  imports = lib.optional (builtins.pathExists ./devenv.local.nix) ./devenv.local.nix;

  # Avoid blocking shell startup on optional Cachix metadata checks. Nix's
  # configured substituters are still used for actual builds.
  cachix.enable = false;
  dotenv.disableHint = true;

  # https://devenv.sh/languages/
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_24;
    pnpm = {
      enable = true;
      package = pnpmPackage;
    };
  };

  # https://devenv.sh/packages/
  packages = with pkgs; [
    pnpmPackage
    postgresql_17
    typescript-language-server
    nixd
    nil
    # Rendition transcoding and poster extraction in the media pipeline.
    ffmpeg-headless
    cargo
    rustc
    rustfmt
    clippy
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
    # Auth toggles are intentionally NOT set here: unset variables leave them
    # DB-owned, so dev exercises the admin-UI-managed path (the default for
    # self-hosters). Export ALLOY_OPEN_REGISTRATIONS etc. to test env locking.
    ALLOY_UPLOAD_TTL_SEC = "900";
    ALLOY_STORAGE_FS_CLIPS_PATH = "${config.devenv.root}/data/storage/clips";
    ALLOY_STORAGE_FS_THUMBNAILS_PATH = "${config.devenv.root}/data/storage/thumbnails";
    ALLOY_STORAGE_FS_ASSETS_PATH = "${config.devenv.root}/data/storage/assets";

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

    alloy_env_file="${config.devenv.root}/.env"
    alloy_secret() {
      ${pkgs.openssl}/bin/openssl rand -base64 48 | tr -d '\n'
    }

    if [ ! -e "$alloy_env_file" ]; then
      alloy_viewer_cookie_secret="$(alloy_secret)"
      alloy_upload_hmac_secret="$(alloy_secret)"

      umask 077
      cat >"$alloy_env_file" <<EOF
# Local development fallback values. The devenv shell exports DATABASE_URL for
# its managed Postgres and shell variables always win over this file.
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/alloy

PORT=2552
PUBLIC_SERVER_URL=http://localhost:2552
TRUSTED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173

ALLOY_VIEWER_COOKIE_SECRET=$alloy_viewer_cookie_secret
ALLOY_UPLOAD_HMAC_SECRET=$alloy_upload_hmac_secret

ALLOY_UPLOAD_TTL_SEC=900

ALLOY_STORAGE_FS_CLIPS_PATH=../../data/storage/clips
ALLOY_STORAGE_FS_THUMBNAILS_PATH=../../data/storage/thumbnails
ALLOY_STORAGE_FS_ASSETS_PATH=../../data/storage/assets
EOF
      chmod 600 "$alloy_env_file"
      echo "Created .env with generated local secrets" >&2
    fi

    alloy_env_value() {
      sed -n "s/^$1=//p" "$alloy_env_file" | tail -n 1
    }

    alloy_ensure_env_secret() {
      alloy_env_key="$1"
      alloy_env_current="$(alloy_env_value "$alloy_env_key")"
      if [ -n "$alloy_env_current" ]; then
        printf '%s\n' "$alloy_env_current"
        return 0
      fi

      alloy_env_generated="$(alloy_secret)"
      {
        printf '\n'
        printf '%s=%s\n' "$alloy_env_key" "$alloy_env_generated"
      } >>"$alloy_env_file"
      chmod 600 "$alloy_env_file"
      echo "Added $alloy_env_key to .env with a generated local secret" >&2
      printf '%s\n' "$alloy_env_generated"
    }

    export ALLOY_VIEWER_COOKIE_SECRET="''${ALLOY_VIEWER_COOKIE_SECRET:-$(alloy_ensure_env_secret ALLOY_VIEWER_COOKIE_SECRET)}"
    export ALLOY_UPLOAD_HMAC_SECRET="''${ALLOY_UPLOAD_HMAC_SECRET:-$(alloy_ensure_env_secret ALLOY_UPLOAD_HMAC_SECRET)}"

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
    alloy_pg_lock_wait_sec=30

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

    alloy_pg_recover_running() {
      [ -s "$alloy_pg_data/postmaster.pid" ] || return 1
      alloy_pg_existing_pid="$(sed -n '1p' "$alloy_pg_data/postmaster.pid")"
      alloy_pg_existing_port="$(sed -n '4p' "$alloy_pg_data/postmaster.pid")"
      [ -n "$alloy_pg_existing_pid" ] || return 1
      [ -n "$alloy_pg_existing_port" ] || return 1
      kill -0 "$alloy_pg_existing_pid" >/dev/null 2>&1 || return 1
      pg_isready \
        -h 127.0.0.1 \
        -p "$alloy_pg_existing_port" \
        -U "$alloy_pg_user" \
        -d "$alloy_pg_db" \
        >/dev/null 2>&1 || return 1

      sed -n '1p' "$alloy_pg_data/postmaster.pid" >"$alloy_pg_pid"
      {
        printf 'PGHOST=127.0.0.1\n'
        printf 'PGPORT=%s\n' "$alloy_pg_existing_port"
        printf 'DATABASE_URL=postgres://postgres@127.0.0.1:%s/alloy\n' "$alloy_pg_existing_port"
      } >"$alloy_pg_env"
    }

    # Serialize startup across shells inside a subshell that owns the lock
    # fd, so the flock releases when the subshell exits. Never install an
    # EXIT trap here: this hook runs inside direnv's rc bash, which exports
    # the environment from its own EXIT trap; overwriting or clearing it
    # makes direnv silently load nothing.
    (
    if ! "$alloy_flock" -w "$alloy_pg_lock_wait_sec" 9; then
      echo "Timed out waiting for Alloy dev Postgres startup lock" >&2
      echo "If no other shell is starting, run alloy-postgres-stop and try again." >&2
      exit 1
    fi

    if ! alloy_pg_ready && ! alloy_pg_recover_running; then
      rm -f "$alloy_pg_env"

      alloy_pg_port="$(alloy_pg_pick_port)"

      if [ ! -s "$alloy_pg_data/PG_VERSION" ]; then
        initdb \
          -D "$alloy_pg_data" \
          -U "$alloy_pg_user" \
          --auth=trust \
          --no-locale \
          >/dev/null \
          9>&-
      fi

      # direnv captures hook output on extra file descriptors. Close them for
      # the daemon starter so Postgres cannot keep `direnv export` alive.
      pg_ctl \
        -D "$alloy_pg_data" \
        -l "$alloy_pg_log" \
        -o "-h 127.0.0.1 -p $alloy_pg_port -k $alloy_pg_run" \
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
        >/dev/null 2>&1 \
        9>&- || true
    fi
    ) 9>"$alloy_pg_lock"

    . "$alloy_pg_env"
    export PGHOST PGPORT DATABASE_URL

    if [ "$alloy_had_errexit" = 0 ]; then
      set +e
    fi
    if [ "$alloy_had_nounset" = 0 ]; then
      set +u
    fi
    unset alloy_had_errexit alloy_had_nounset

    echo "Alloy dev Postgres: $DATABASE_URL" >&2
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
