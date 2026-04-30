{
  fetchPnpmDeps,
  jellyfin-ffmpeg,
  lib,
  nodejs_24,
  pnpm_10,
  pnpmConfigHook,
  stdenv,
}:

let
  packageJson = lib.importJSON ../package.json;
in
stdenv.mkDerivation (finalAttrs: {
  pname = "alloy";
  inherit (packageJson) version;

  src = lib.cleanSourceWith {
    src = ../.;
    filter =
      path: type:
      let
        rel = lib.removePrefix "${toString ../.}/" (toString path);
        base = baseNameOf path;
      in
      !(base == ".git"
        || base == "node_modules"
        || base == ".turbo"
        || base == "dist"
        || base == "build"
        || lib.hasSuffix ".log" rel)
      && (
        rel == "package.json"
        || rel == "pnpm-lock.yaml"
        || rel == "pnpm-workspace.yaml"
        || rel == "turbo.json"
        || rel == "tsconfig.json"
        || rel == "apps"
        || lib.hasPrefix "apps/" rel
        || rel == "packages"
        || lib.hasPrefix "packages/" rel
        || rel == "public"
        || lib.hasPrefix "public/" rel
      );
  };

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname src version;
    pnpm = pnpm_10;
    fetcherVersion = 3;
    hash = "sha256-eTIiJPQyU4iwYVSPi0EsyRbnMEs2uibugp0da2UM+w0=";
  };

  nativeBuildInputs = [
    nodejs_24
    pnpmConfigHook
    pnpm_10
  ];

  buildPhase = ''
    runHook preBuild

    pnpm build
    pnpm package:web

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/bin" "$out/share/alloy"
    cp -R \
      package.json \
      pnpm-lock.yaml \
      pnpm-workspace.yaml \
      turbo.json \
      tsconfig.json \
      apps \
      packages \
      build \
      node_modules \
      "$out/share/alloy/"
    find "$out/share/alloy" -name '.env*' -type f -delete

    mv "$out/share/alloy/build/www" "$out/share/alloy/www"
    rmdir "$out/share/alloy/build"

    cat > "$out/bin/alloy" <<EOF
    #!${stdenv.shell}
    set -e
    export PATH="${lib.makeBinPath [ nodejs_24 jellyfin-ffmpeg ]}:\$PATH"
    state_dir="\''${ALLOY_STATE_DIR-\''${XDG_STATE_HOME:-\$HOME/.local/state}/alloy}"
    export ALLOY_CONFIG_FILE="\''${ALLOY_CONFIG_FILE-\$state_dir/config.json}"
    export ENCODE_SCRATCH_DIR="\''${ENCODE_SCRATCH_DIR-\$state_dir/scratch}"
    export WEB_DIST_DIR="\''${WEB_DIST_DIR-$out/share/alloy/www}"
    export FFMPEG_BIN="\''${FFMPEG_BIN-${lib.getExe jellyfin-ffmpeg}}"
    export FFPROBE_BIN="\''${FFPROBE_BIN-${jellyfin-ffmpeg}/bin/ffprobe}"
    mkdir -p "\$state_dir/data/storage" "\$ENCODE_SCRATCH_DIR"
    cd "\$state_dir"
    exec "$out/share/alloy/apps/server/node_modules/.bin/tsx" "$out/share/alloy/apps/server/src/index.ts" "\$@"
    EOF
    chmod +x "$out/bin/alloy"

    runHook postInstall
  '';

  meta = {
    description = "Open-source and self-hostable alternative to Medal.tv";
    homepage = "https://github.com/zekurio/alloy";
    license = lib.licenses.agpl3Only;
    mainProgram = "alloy";
    platforms = lib.platforms.linux;
  };
})
