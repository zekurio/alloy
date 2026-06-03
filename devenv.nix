{
  pkgs,
  lib,
  config,
  ...
}:
let
  # Native libraries the Deno runtime/npm deps dlopen at dev time. Mirrors the
  # set the packaged server links in nix/package.nix.
  nativeLibs = with pkgs; [
    stdenv.cc.cc.lib
    zlib
    zstd
  ];
  dataDir = "${config.devenv.root}/data";
in
{
  # https://devenv.sh/languages/
  # Deno comes from the pinned nixpkgs (see devenv.yaml). Keep that channel in
  # sync with flake.nix so the dev Deno matches the packaged/CI Deno; the server
  # is `deno compile`d against a denort runtime pinned to one exact version.
  languages.deno.enable = true;

  # https://devenv.sh/packages/
  # The machine-learning service owns its own uv-managed venv
  # (machine-learning/.venv) via the Immich-style workflow, so we expose uv and
  # Python as plain tools rather than enabling languages.python.uv.sync; a
  # devenv root venv (VIRTUAL_ENV) would fight uv inside machine-learning/.
  packages = with pkgs; [
    python311
    uv
    postgresql_17 # psql / pg_isready on PATH for local service commands
    jellyfin-ffmpeg
    imagemagick
  ] ++ nativeLibs;

  # Single source of truth for the static dev environment.
  env = {
    LD_LIBRARY_PATH = lib.makeLibraryPath nativeLibs;
    DATABASE_URL = "postgres://postgres@127.0.0.1:5432/alloy";
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
  };

  # https://devenv.sh/supported-services/postgres/
  # Data lives under .devenv/state/postgres. devenv's bootstrap superuser is the
  # current system user, so create the `postgres` role to match DATABASE_URL
  # (user=postgres) connecting over TCP with trust auth on 127.0.0.1.
  services.postgres = {
    enable = true;
    package = pkgs.postgresql_17;
    listen_addresses = "127.0.0.1";
    port = 5432;
    initialDatabases = [ { name = "alloy"; } ];
    initialScript = "CREATE ROLE postgres SUPERUSER LOGIN;";
  };

  # https://devenv.sh/scripts/
  # Optional uv sync (Immich-style), then run the ML service.
  scripts.dev-ml.exec = ''
    set -eu
    cd "${config.devenv.root}/machine-learning"
    if [ "''${MACHINE_LEARNING_UV_SYNC:-1}" != "0" ]; then
      uv sync --extra "''${MACHINE_LEARNING_UV_EXTRA:-cpu}"
    fi
    exec uv run python -m alloy_ml
  '';

  # https://devenv.sh/tasks/
  # The API process waits for this task so the dev schema is current before the
  # server starts.
  tasks."alloy:db-push" = {
    after = [ "devenv:processes:postgres" ];
    exec = "deno task db:push";
  };

  # https://devenv.sh/processes/
  # devenv owns the dev process graph. Deno tasks in deno.json are thin aliases
  # that select which processes to start.
  processes = {
    api = {
      after = [ "alloy:db-push" ];
      exec = ''
        export PORT="''${PORT:-2552}"
        export PUBLIC_SERVER_URL="''${PUBLIC_SERVER_URL:-http://localhost:$PORT}"
        export MACHINE_LEARNING_ENABLED="1"
        export MACHINE_LEARNING_URL="''${MACHINE_LEARNING_URL:-http://localhost:''${ALLOY_ML_PORT:-2662}}"
        exec deno task --quiet --cwd apps/server dev
      '';
      ready.http.get = {
        port = 2552;
        path = "/health";
      };
    };

    web = {
      ports.http.allocate = 5173;
      exec = "deno task --quiet --cwd apps/web dev";
      ready.http.get = {
        port = config.processes.web.ports.http.value;
        path = "/";
      };
    };

    ml = {
      ports.http.allocate = 2662;
      exec = "dev-ml";
      ready.http.get = {
        port = config.processes.ml.ports.http.value;
        path = "/health";
      };
    };
  };

  # See full reference at https://devenv.sh/reference/options/
}
