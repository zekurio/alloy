{
  description = "alloy";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      ...
    }:
    let
      systems = [ "x86_64-linux" ];
      version = (builtins.fromJSON (builtins.readFile ./deno.json)).version;
    in
    flake-utils.lib.eachSystem systems (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        alloy = pkgs.callPackage ./nix/package.nix { inherit version; };
        nativeLibs = with pkgs; [
          stdenv.cc.cc.lib
        ];
      in
      {
        packages = {
          default = alloy;
          inherit alloy;
        };

        checks.default = alloy;

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            deno
            postgresql_17
            util-linux
            jellyfin-ffmpeg
            imagemagick
          ] ++ nativeLibs;

          LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath nativeLibs;

          shellHook = ''
            export ALLOY_ROOT="$PWD"
            export PGROOT="$PWD/.pg"
            export PGDATA="$PGROOT/data"
            export PGSOCKETDIR="$PGROOT/sockets"
            export PG_MAJOR="17"
            export PGHOST="127.0.0.1"
            export PGPORT="5432"
            export PGUSER="postgres"
            export PGDATABASE="alloy"
            export DATABASE_URL="postgres://$PGUSER@$PGHOST:$PGPORT/$PGDATABASE"

            mkdir -p "$PGROOT" "$PGSOCKETDIR"

            alloy_pg_start() {
              "$ALLOY_ROOT/scripts/dev-postgres.sh" start
            }
            export -f alloy_pg_start

            alloy_pg_stop() {
              "$ALLOY_ROOT/scripts/dev-postgres.sh" stop
            }
            export -f alloy_pg_stop

            alloy_pg_status() {
              "$ALLOY_ROOT/scripts/dev-postgres.sh" status
            }
            export -f alloy_pg_status
          '';
        };
      }
    )
    // {
      nixosModules.default = import ./nix/module.nix { inherit self; };
    };
}
