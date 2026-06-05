{
  lib,
  stdenvNoCC,
  fetchPnpmDeps,
  nodejs_24,
  pnpm,
  pnpmConfigHook,
  makeWrapper,
  jellyfin-ffmpeg,
  imagemagick,
  which,
  version ? (builtins.fromJSON (builtins.readFile ../package.json)).version,
  source ? import ./source.nix {
    inherit lib;
    root = ../.;
  },
  pnpmDepsHash ? "sha256-XD/u9QqTZbZp3Eb/0j9aXNJeOrGMY5pqcYIIbO7/fDs=",
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "alloy";
  inherit version;
  src = source;

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    inherit pnpm;
    fetcherVersion = 3;
    hash = pnpmDepsHash;
  };

  nativeBuildInputs = [
    nodejs_24
    pnpm
    pnpmConfigHook
    makeWrapper
  ];

  buildPhase = ''
    runHook preBuild

    export HOME="$TMPDIR/home"
    export TURBO_TELEMETRY_DISABLED=1
    export DO_NOT_TRACK=1
    mkdir -p "$HOME"

    pnpm build

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/bin" "$out/share/alloy/server/node_modules" "$out/share/alloy/web"
    cp -R apps/server/dist apps/server/package.json "$out/share/alloy/server/"
    cp -R node_modules/.pnpm "$out/share/alloy/server/node_modules/.pnpm"
    rm -rf "$out/share/alloy/server/node_modules/.pnpm/node_modules/@workspace"

    linkNodeModule() {
      local name="$1"
      local src="apps/server/node_modules/$name"
      local dest="$out/share/alloy/server/node_modules/$name"
      local target
      target="$(readlink "$src")"
      target="$out/share/alloy/server/node_modules/.pnpm/''${target#*node_modules/.pnpm/}"
      mkdir -p "$(dirname "$dest")"
      ln -s "$target" "$dest"
    }

    for name in \
      @hono/node-server \
      @hono/zod-validator \
      @simplewebauthn/server \
      drizzle-orm \
      hono \
      openid-client \
      pg \
      zod
    do
      linkNodeModule "$name"
    done

    cp -R apps/web/dist/* "$out/share/alloy/web/"
    cp -R packages/db/drizzle "$out/share/alloy/migrations"

    makeWrapper "${nodejs_24}/bin/node" "$out/bin/alloy" \
      --add-flags "$out/share/alloy/server/dist/index.js" \
      --prefix PATH : "${
        lib.makeBinPath [
          imagemagick
          which
        ]
      }" \
      --set-default NODE_ENV production \
      --set-default WEB_DIST_DIR "$out/share/alloy/web" \
      --set-default ALLOY_MIGRATIONS_DIR "$out/share/alloy/migrations" \
      --set-default FFMPEG_BIN "${jellyfin-ffmpeg}/bin/ffmpeg" \
      --set-default FFPROBE_BIN "${jellyfin-ffmpeg}/bin/ffprobe"

    runHook postInstall
  '';

  meta = {
    description = "Open-source and self-hostable alternative to Medal.tv";
    homepage = "https://github.com/zekurio/alloy";
    license = lib.licenses.agpl3Only;
    mainProgram = "alloy";
    platforms = [ "x86_64-linux" ];
  };
})
