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
  pnpmPackage = import ./nix/pnpm.nix { inherit (pkgs) pnpm_11; };
  postgres = pkgs.postgresql_17;
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
    postgres
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
    ALLOY_STORAGE_FS_CLIPS_PATH = "${config.devenv.root}/data/storage/clips";
    ALLOY_STORAGE_FS_THUMBNAILS_PATH = "${config.devenv.root}/data/storage/thumbnails";
    ALLOY_STORAGE_FS_ASSETS_PATH = "${config.devenv.root}/data/storage/assets";

  };

  # Start one repo-local postgres for all active shells. It listens on a
  # random free localhost port picked at startup (never colliding with a
  # system-wide Postgres service); the port is persisted in the shared env
  # file and exported as DATABASE_URL, which takes precedence over the repo
  # `.env`. This hook runs inside direnv's rc bash, which exports the
  # environment from its own EXIT trap: keep the work in the scripts below and
  # never set a trap here.
  enterShell = ''
    alloy-dotenv || exit $?
    alloy-postgres start || exit $?

    . "${config.devenv.root}/.devenv/run/postgres/env"
    export PGHOST PGPORT DATABASE_URL

    alloy_env_value() {
      sed -n "s/^$1=//p" "${config.devenv.root}/.env" | tail -n 1
    }
    export ALLOY_VIEWER_COOKIE_SECRET="''${ALLOY_VIEWER_COOKIE_SECRET:-$(alloy_env_value ALLOY_VIEWER_COOKIE_SECRET)}"
    export ALLOY_UPLOAD_HMAC_SECRET="''${ALLOY_UPLOAD_HMAC_SECRET:-$(alloy_env_value ALLOY_UPLOAD_HMAC_SECRET)}"
    unset -f alloy_env_value

    echo "Alloy dev Postgres: $DATABASE_URL" >&2
  '';

  scripts = {
    alloy-dotenv = {
      exec = ./nix/dev-dotenv.sh;
      packages = [ pkgs.openssl ];
      description = "create .env with generated local secrets";
    };
    alloy-postgres = {
      exec = ./nix/dev-postgres.sh;
      packages = [
        postgres
        pkgs.util-linuxMinimal
      ];
      description = "start or stop the repo-local dev Postgres";
    };
    alloy-postgres-stop.exec = "alloy-postgres stop";
  };

  # See full reference at https://devenv.sh/reference/options/
}
