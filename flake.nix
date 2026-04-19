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
            # Local dev database — data dir + sockets live in ./.pg (gitignored).
            # Init:   mkdir -p .pg/sockets
            #         initdb -D .pg/data -U postgres --auth-host=trust --auth-local=trust
            # Start:  pg_ctl -D .pg/data -l .pg/logfile \
            #           -o "-p 5432 -h 127.0.0.1 -k \"$PWD/.pg/sockets\"" start
            #         createdb -h 127.0.0.1 -U postgres alloy
            # Stop:   pg_ctl -D .pg/data stop
            postgresql_16
            # ffmpeg + ffprobe drive the encode queue (`apps/server/src/queue/`).
            # `ffmpeg-headless` is the trimmed build — no GUI deps — which is
            # all the server needs.
            ffmpeg-headless
          ];
        };
      }
    );
}
