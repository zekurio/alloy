{
  lib,
  stdenvNoCC,
  fetchPnpmDeps,
  ffmpeg-headless,
  ffmpegPackage ? ffmpeg-headless,
  nodejs_24,
  nodejs-slim_24,
  pnpm,
  pnpmConfigHook,
  makeWrapper,
  version ? (builtins.fromJSON (builtins.readFile ../package.json)).version,
  source ? import ./source.nix {
    inherit lib;
    root = ../.;
  },
  pnpmDepsHash ? "sha256-amRJTkO6mi1a706+Hj547RmJ0cAwm6FNMCeZ8poAVg8=",
}:

let
  pnpmPackage = import ./pnpm.nix { inherit pnpm; };
in
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "alloy";
  inherit version;
  src = source;

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    pnpm = pnpmPackage;
    fetcherVersion = 4;
    hash = pnpmDepsHash;
  };

  nativeBuildInputs = [
    nodejs_24
    pnpmPackage
    pnpmConfigHook
    makeWrapper
  ];

  # Nothing in the shipped node_modules is executed via shebang (node only
  # requires the libraries), and patching would re-point #!/usr/bin/env node
  # CLI scripts at the full build-time nodejs, dragging its -dev closure
  # into the runtime closure.
  dontPatchShebangs = true;

  buildPhase = ''
    runHook preBuild

    export HOME="$TMPDIR/home"
    export TURBO_TELEMETRY_DISABLED=1
    export DO_NOT_TRACK=1
    mkdir -p "$HOME"

    pnpm --filter @alloy/server build
    pnpm --filter @alloy/web build

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/share/alloy/server"
    cp -R packages/server/dist "$out/share/alloy/server/dist"
    cp packages/server/package.json "$out/share/alloy/server/"

    # Ship only the runtime closure of the server's external dependencies
    # instead of the whole workspace store (which would include
    # devDependencies like electron and vite). pnpm deploy cannot do this
    # offline in the build sandbox, so the closure is walked directly.
    node scripts/prune-server-node-modules.mjs . "$out/share/alloy/server"

    # pnpmConfigHook patches node_modules shebangs to the build-time nodejs;
    # re-point them at the slim runtime so the full nodejs (and its -dev
    # closure) stays out of the runtime closure.
    grep -IRl "${nodejs_24}" "$out/share/alloy/server/node_modules" | while IFS= read -r file; do
      sed -i "s|${nodejs_24}|${nodejs-slim_24}|g" "$file"
    done

    cp -R packages/web/dist "$out/share/alloy/web"
    cp -R packages/db/drizzle "$out/share/alloy/migrations"

    # Run on nodejs-slim: the full nodejs package retains node-gyp headers
    # and their -dev closures, which the server never needs at runtime.
    # ffmpeg is on PATH for the rendition transcode pipeline and poster
    # extraction; override with ALLOY_FFMPEG_PATH if needed.
    makeWrapper "${nodejs-slim_24}/bin/node" "$out/bin/alloy" \
      --add-flags "$out/share/alloy/server/dist/index.js" \
      --prefix PATH : "${lib.makeBinPath [ ffmpegPackage ]}" \
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
