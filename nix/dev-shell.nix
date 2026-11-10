# The development shell: Node, pnpm, PostgreSQL, FFmpeg and Rust from the same
# nixpkgs the packages build with, plus a repo-local Postgres that the entry
# hook starts. `nix develop` enters it; `.envrc` does the same through direnv.
{
  lib,
  mkShell,
  writeShellScriptBin,
  callPackage,
  bash,
  nodejs_24,
  pnpm_11,
  postgresql_17,
  coreutils,
  util-linuxMinimal,
  typescript-language-server,
  nixd,
  nil,
  ffmpeg-headless,
  cargo,
  rustc,
  rustfmt,
  clippy,
  pkg-config,
  alsa-lib,
}:
let
  pnpmPackage = import ./pnpm.nix { inherit pnpm_11; };

  # The scripts stay plain files so they can be read and run by hand; the
  # wrappers only put the tools they call on PATH.
  script =
    name: file: tools:
    writeShellScriptBin name ''
      export PATH=${lib.makeBinPath tools}:$PATH
      exec ${lib.getExe bash} ${file} "$@"
    '';
  alloy-dotenv = script "alloy-dotenv" ./dev-dotenv.sh [ coreutils ];
  alloy-postgres = script "alloy-postgres" ./dev-postgres.sh [
    postgresql_17
    util-linuxMinimal
  ];
in
mkShell {
  packages = [
    nodejs_24
    pnpmPackage
    postgresql_17
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
    clippy
    pkg-config
    alloy-dotenv
    alloy-postgres
  ];

  # The recorder library the host links plays sounds through ALSA.
  buildInputs = [ alsa-lib ];

  # The static part of the dev environment. `pnpm dev` passes all of it to
  # the server and web processes. Admin settings are intentionally NOT set
  # here, so dev starts from the built-in defaults; export
  # ALLOY_OPEN_REGISTRATIONS etc. to test env defaults under admin overrides.
  env = {
    NODE_ENV = "development";
    PORT = "2552";
    PUBLIC_SERVER_URL = "http://localhost:2552";
    # Dev serves the web app from Vite (5173); the server adds its own public
    # origin to the trusted set on top of this.
    TRUSTED_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173";
    # The PG* variables let psql and the pg_* tools connect without flags.
    PGUSER = "postgres";
    PGDATABASE = "alloy";
    # The Electron binary npm downloads does not run on NixOS, so
    # electron-vite starts the desktop shell on the pinned release built for
    # Nix.
    ELECTRON_EXEC_PATH = "${callPackage ./electron.nix { }}/bin/electron";
  };

  # Sets the paths that depend on the checkout, creates `.env`, and starts the
  # one Postgres shared by all shells of this checkout. direnv evaluates this
  # hook in its own bash, which exports the environment from an EXIT trap:
  # keep the work in the two scripts and never set a trap here.
  shellHook = ''
    DEVSHELL_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
    # Short enough for a Unix socket path and unique per checkout.
    DEVSHELL_RUNTIME="''${XDG_RUNTIME_DIR:-/tmp}/alloy-dev-$(printf %s "$DEVSHELL_ROOT" | sha256sum | cut -c1-8)"
    export DEVSHELL_ROOT DEVSHELL_RUNTIME

    # The repo-local Postgres listens on a Unix socket only, so the URL takes
    # precedence over the `.env` fallback. dev-postgres.sh uses the same
    # socket directory.
    export PGHOST="$DEVSHELL_RUNTIME/postgres"
    export DATABASE_URL="postgres://postgres@localhost/alloy?host=$PGHOST"
    export ALLOY_STORAGE_FS_CLIPS_PATH="$DEVSHELL_ROOT/data/storage/clips"
    export ALLOY_STORAGE_FS_THUMBNAILS_PATH="$DEVSHELL_ROOT/data/storage/thumbnails"
    export ALLOY_STORAGE_FS_ASSETS_PATH="$DEVSHELL_ROOT/data/storage/assets"

    alloy-dotenv || exit $?
    alloy-postgres start || exit $?

    echo "Alloy dev Postgres: $DATABASE_URL" >&2
  '';
}
