{
  description = "alloy";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    let
      overlay = final: _prev: {
        alloy-clips = final.callPackage ./nix/package.nix { };
      };
    in
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ overlay ];
        };
      in
      {
        packages = {
          alloy = pkgs.alloy-clips;
          default = pkgs.alloy-clips;
        };

        apps.default = {
          type = "app";
          program = "${pkgs.alloy-clips}/bin/alloy";
        };

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs
            pnpm
            postgresql_17
            util-linux
            jellyfin-ffmpeg
          ];

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
      overlays.default = overlay;

      nixosModules = {
        alloy = import ./nix/module.nix;
        default = self.nixosModules.alloy;
      };
    };
}
