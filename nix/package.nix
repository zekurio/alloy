{
  lib,
  stdenvNoCC,
  fetchPnpmDeps,
  nodejs_24,
  pnpm,
  pnpmConfigHook,
  makeWrapper,
  imagemagick,
  which,
  version ? (builtins.fromJSON (builtins.readFile ../package.json)).version,
  source ? import ./source.nix {
    inherit lib;
    root = ../.;
  },
  pnpmDepsHash ? "sha256-Mwyb1MZfMaxvBjDC/aY8gPwX1mEhL6baO1q8k1UM1ZM=",
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

    pnpm --filter alloy-server build
    pnpm --filter alloy-web build

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/bin" "$out/share/alloy/server/node_modules" "$out/share/alloy/web"
    cp -R packages/server/dist packages/server/package.json "$out/share/alloy/server/"
    cp -R node_modules/.pnpm "$out/share/alloy/server/node_modules/.pnpm"
    rm -rf \
      "$out/share/alloy/server/node_modules/.pnpm/node_modules/@workspace" \
      "$out/share/alloy/server/node_modules/.pnpm/node_modules"/alloy-*

    linkNodeModule() {
      local name="$1"
      local src="packages/server/node_modules/$name"
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
      blurhash \
      croner \
      drizzle-orm \
      hono \
      mediabunny \
      openid-client \
      pg \
      sharp \
      zod
    do
      linkNodeModule "$name"
    done

    cp -R packages/web/dist/* "$out/share/alloy/web/"
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
      --set-default ALLOY_MIGRATIONS_DIR "$out/share/alloy/migrations"

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
