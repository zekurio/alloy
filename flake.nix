{
  description = "alloy - devShell";

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
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs
            pnpm
            postgresql_17
            util-linux
            # ffmpeg + ffprobe drive the encode queue (`apps/server/src/queue/`).
            # `ffmpeg-headless` is the trimmed build — no GUI deps — which is
            # all the server needs.
            ffmpeg-headless
          ];

          shellHook = ''
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

            (
              flock 9

              if [ -f "$PGDATA/PG_VERSION" ]; then
                current_pg_major="$(cat "$PGDATA/PG_VERSION")"
                if [ "$current_pg_major" != "$PG_MAJOR" ]; then
                  backup_dir="$PGROOT/data-pg$current_pg_major-$(date +%Y%m%d%H%M%S)"
                  if [ -d "$PGDATA" ]; then
                    mv "$PGDATA" "$backup_dir"
                    echo "Moved incompatible PostgreSQL data dir to $backup_dir"
                  fi
                fi
              fi

              if [ ! -d "$PGDATA/base" ]; then
                rm -rf "$PGDATA"
                initdb -D "$PGDATA" -U "$PGUSER" --auth-host=trust --auth-local=trust >/dev/null
              fi

              if ! pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
                pg_ctl \
                  -D "$PGDATA" \
                  -l "$PGROOT/logfile" \
                  -o "-p $PGPORT -h $PGHOST -k $PGSOCKETDIR" \
                  start >/dev/null
              fi

              if ! pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" >/dev/null 2>&1; then
                echo "PostgreSQL did not become ready on $PGHOST:$PGPORT" >&2
              fi

              if ! psql -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname = '$PGDATABASE'" | grep -q 1; then
                createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$PGDATABASE"
              fi
            ) 9>"$PGROOT/.setup.lock"

            alloy_pg_stop() {
              pg_ctl -D "$PGDATA" stop
            }
            export -f alloy_pg_stop
          '';
        };
      }
    );
}
