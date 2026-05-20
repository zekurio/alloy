{
  lib,
  stdenvNoCC,
  deno,
  nodejs,
  makeWrapper,
  ffmpeg-headless,
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
  denoDepsHash ? "sha256-hRd7II9k6J3FSA80Y7wpb6kjCqgk02vsJI/H0QUWj18=",
}:

let
  pname = "alloy";
  version = "0.0.1";

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

      deno install --frozen
      deno cache --frozen apps/server/src/index.ts apps/web/vite.config.ts
      deno compile \
        --cached-only \
        --frozen \
        --target x86_64-unknown-linux-gnu \
        --output "$TMPDIR/alloy-server-probe" \
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

      mkdir -p "$out"
      cp -R "$DENO_DIR" "$out/deno-dir"
      rm -rf \
        "$out/deno-dir/dep_analysis_cache"* \
        "$out/deno-dir/gen" \
        "$out/deno-dir/node_analysis_cache"*
      if [ -d node_modules ]; then
        cp -R node_modules "$out/node_modules"
      fi

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

    if [ -d "${denoDeps}/node_modules" ]; then
      cp -R "${denoDeps}/node_modules" node_modules
      chmod -R u+w node_modules
    fi

    deno task build
    deno compile \
      --cached-only \
      --frozen \
      --target x86_64-unknown-linux-gnu \
      --output alloy-server \
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

    install -Dm755 alloy-server "$out/libexec/alloy-server"
    mkdir -p "$out/bin" "$out/share/alloy"
    cp -R apps/web/dist "$out/share/alloy/web"
    cp -R packages/db/drizzle "$out/share/alloy/migrations"

    makeWrapper "$out/libexec/alloy-server" "$out/bin/alloy-server" \
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
    mainProgram = "alloy-server";
    platforms = [ "x86_64-linux" ];
  };
}
