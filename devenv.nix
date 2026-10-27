{
  pkgs,
  lib,
  config,
  ...
}:
let
  pnpmPackage = import ./nix/pnpm.nix { inherit (pkgs) pnpm_11; };
  postgres = pkgs.postgresql_17;
  # Socket directory of the repo-local Postgres; nix/dev-postgres.sh derives
  # the same path from DEVENV_RUNTIME. devenv keeps that directory short
  # enough for Unix sockets and unique per checkout.
  postgresSocketDir = "${config.devenv.runtime}/postgres";
in
{
  # devenv.local.nix is loaded by devenv itself when present; importing it
  # here would apply it twice.

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
    postgres
    typescript-language-server
    nixd
    nil
    # Rendition transcoding and poster extraction in the media pipeline.
    ffmpeg-headless
    # The desktop host and its addon build here for the Electron shell; the
    # Windows recorder and the installer build on Windows. CI formats with
    # rustup's stable toolchain, which nixpkgs' current stable rustfmt tracks
    # closely.
    cargo
    rustc
    rustfmt
    # The recorder library the host links plays sounds through ALSA.
    pkg-config
    alsa-lib.dev
  ];

  # Single source of truth for the static dev environment. `pnpm dev` goes
  # through turbo, which forwards only the names in turbo.json (globalEnv plus
  # the dev task's ALLOY_* pass-through) to the server and web processes.
  env = {
    NODE_ENV = "development";
    PORT = "2552";
    PUBLIC_SERVER_URL = "http://localhost:2552";
    # Dev serves the web app from Vite (5173); the server adds its own public
    # origin to the trusted set on top of this.
    TRUSTED_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173";
    # The repo-local Postgres listens on a Unix socket only, so the URL is
    # static and takes precedence over the `.env` fallback. The PG* variables
    # let psql and the pg_* tools connect without flags.
    DATABASE_URL = "postgres://postgres@localhost/alloy?host=${postgresSocketDir}";
    PGHOST = postgresSocketDir;
    PGUSER = "postgres";
    PGDATABASE = "alloy";
    # Auth toggles are intentionally NOT set here: unset variables leave them
    # DB-owned, so dev exercises the admin-UI-managed path (the default for
    # self-hosters). Export ALLOY_OPEN_REGISTRATIONS etc. to test env locking.
    ALLOY_STORAGE_FS_CLIPS_PATH = "${config.devenv.root}/data/storage/clips";
    ALLOY_STORAGE_FS_THUMBNAILS_PATH = "${config.devenv.root}/data/storage/thumbnails";
    ALLOY_STORAGE_FS_ASSETS_PATH = "${config.devenv.root}/data/storage/assets";
    # The Electron binary npm downloads does not run on NixOS, so
    # electron-vite starts the desktop shell on the pinned release built for
    # Nix.
    ELECTRON_EXEC_PATH = "${pkgs.callPackage ./nix/electron.nix { }}/bin/electron";
  };

  # Create `.env` and start the one Postgres shared by all active shells. This
  # hook runs inside direnv's rc bash, which exports the environment from its
  # own EXIT trap: keep the work in the scripts below and never set a trap
  # here.
  enterShell = ''
    alloy-dotenv || exit $?
    alloy-postgres start || exit $?

    alloy_env_value() {
      sed -n "s/^$1=//p" "${config.devenv.root}/.env" | tail -n 1
    }
    export ALLOY_VIEWER_COOKIE_SECRET="''${ALLOY_VIEWER_COOKIE_SECRET:-$(alloy_env_value ALLOY_VIEWER_COOKIE_SECRET)}"
    export ALLOY_UPLOAD_HMAC_SECRET="''${ALLOY_UPLOAD_HMAC_SECRET:-$(alloy_env_value ALLOY_UPLOAD_HMAC_SECRET)}"
    unset -f alloy_env_value

    echo "Alloy dev Postgres: $DATABASE_URL" >&2
  '';

  # `devenv test` (also run in CI) enters the shell first, so this checks what
  # the hook produced.
  enterTest = ''
    test -s "${config.devenv.root}/.env"
    pg_isready -h "$PGHOST" -U postgres -d alloy
  '';

  scripts = {
    alloy-dotenv = {
      exec = ./nix/dev-dotenv.sh;
      packages = [ pkgs.openssl ];
      description = "create .env from .env.example with generated local secrets";
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
