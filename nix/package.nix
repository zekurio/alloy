{
  lib,
  stdenvNoCC,
  deno,
  nodejs,
  makeWrapper,
  ffmpeg-headless,
  version ? (builtins.fromJSON (builtins.readFile ../deno.json)).version,
  source ? lib.cleanSourceWith {
    src = ../.;
    filter =
      path: type:
      let
        name = baseNameOf path;
      in
      !(
        name == ".direnv"
        || name == ".git"
        || name == ".pg"
        || name == "build"
        || name == "data"
        || name == "dist"
        || name == "node_modules"
      );
  },
  denoDepsHash ? "sha256-wA9UKnIjDsr1VV/PZviFXCop0FnI/eWYClr8WSET/pA=",
}:

let
  pname = "alloy";

  denoDeps = stdenvNoCC.mkDerivation {
    pname = "${pname}-deno-deps";
    inherit version;
    src = source;

    nativeBuildInputs = [
      deno
      nodejs
    ];

    dontConfigure = true;
    dontFixup = true;

    outputHashAlgo = "sha256";
    outputHashMode = "recursive";
    outputHash = denoDepsHash;

    buildPhase = ''
      runHook preBuild

      export HOME="$TMPDIR/home"
      export DENO_DIR="$TMPDIR/deno-dir"
      export DENO_NO_UPDATE_CHECK=1
      mkdir -p "$HOME" "$DENO_DIR"

      deno install --frozen --vendor=true
      deno compile \
        --vendor=true \
        --unstable-sloppy-imports \
        --frozen \
        --target x86_64-unknown-linux-gnu \
        --output "$TMPDIR/alloy-probe" \
        --allow-env \
        --allow-net \
        --allow-read \
        --allow-write \
        --allow-run \
        --allow-ffi \
        --allow-sys=osRelease \
        apps/server/src/index.ts

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p "$out/deno-dir"
      cp -R "$DENO_DIR/dl" "$out/deno-dir/dl"
      cp -R vendor "$out/vendor"
      cp -R node_modules "$out/node_modules"

      runHook postInstall
    '';
  };
in
stdenvNoCC.mkDerivation {
  inherit pname version;
  src = source;

  nativeBuildInputs = [
    deno
    nodejs
    makeWrapper
  ];

  dontConfigure = true;

  buildPhase = ''
    runHook preBuild

    export HOME="$TMPDIR/home"
    export DENO_DIR="$TMPDIR/deno-dir"
    export DENO_NO_UPDATE_CHECK=1
    mkdir -p "$HOME"
    cp -R "${denoDeps}/deno-dir" "$DENO_DIR"
    chmod -R u+w "$DENO_DIR"
    cp -R "${denoDeps}/vendor" vendor
    cp -R "${denoDeps}/node_modules" node_modules
    chmod -R u+w vendor node_modules
    node -e 'const fs = require("node:fs"); const config = JSON.parse(fs.readFileSync("deno.json", "utf8")); config.vendor = true; fs.writeFileSync("deno.json", JSON.stringify(config));'

    deno task build
    deno compile \
      --vendor=true \
      --unstable-sloppy-imports \
      --cached-only \
      --frozen \
      --target x86_64-unknown-linux-gnu \
      --output alloy \
      --allow-env \
      --allow-net \
      --allow-read \
      --allow-write \
      --allow-run \
      --allow-ffi \
      --allow-sys=osRelease \
      apps/server/src/index.ts

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    install -Dm755 alloy "$out/libexec/alloy"
    mkdir -p "$out/bin" "$out/share/alloy"
    cp -R apps/web/dist "$out/share/alloy/web"
    cp -R packages/db/drizzle "$out/share/alloy/migrations"

    makeWrapper "$out/libexec/alloy" "$out/bin/alloy" \
      --set-default NODE_ENV production \
      --set-default WEB_DIST_DIR "$out/share/alloy/web" \
      --set-default ALLOY_MIGRATIONS_DIR "$out/share/alloy/migrations" \
      --set-default FFMPEG_BIN "${ffmpeg-headless}/bin/ffmpeg" \
      --set-default FFPROBE_BIN "${ffmpeg-headless}/bin/ffprobe"

    runHook postInstall
  '';

  meta = {
    description = "Open-source and self-hostable alternative to Medal.tv";
    homepage = "https://github.com/zekurio/alloy";
    license = lib.licenses.agpl3Only;
    mainProgram = "alloy";
    platforms = [ "x86_64-linux" ];
  };
}
