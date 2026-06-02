{
  lib,
  stdenv,
  stdenvNoCC,
  deno,
  nodejs,
  makeWrapper,
  autoPatchelfHook,
  unzip,
  fetchurl,
  jellyfin-ffmpeg,
  imagemagick,
  which,
  version ? (builtins.fromJSON (builtins.readFile ../deno.json)).version,
  source ? import ./source.nix {
    inherit lib;
    root = ../.;
  },
  denoDepsHash ? "sha256-Ig/K+EH+OUNlNXBMT08N24einFVT3tSU26xorMRxCE8=",
  # Must match the denort build for deno ${deno.version}. After bumping nixpkgs
  # (and therefore deno), refresh with:
  #   nix store prefetch-file \
  #     https://dl.deno.land/release/v<ver>/denort-x86_64-unknown-linux-gnu.zip
  denortHash ? "sha256-SrqlGhuewJd9O3zsVV7cYNMZiyeuG5eSodCYVhmUioQ=",
}:

let
  pname = "alloy";
  denoTarget = "x86_64-unknown-linux-gnu";
  # denort is fetched for one exact Deno version, so denortHash is only valid for
  # that version. Keep this in lockstep with denortHash (and with the deno that
  # flake.lock pins). The assertion below turns a Deno/nixpkgs mismatch into a
  # readable error instead of a cryptic fixed-output hash failure.
  denortDenoVersion = "2.8.0";

  # `deno compile` produces (denort runtime + appended payload). The upstream
  # denort binary uses /lib64/ld-linux-x86-64.so.2, which does not exist on
  # NixOS, so the compiled output would only run under nix-ld. Patch denort up
  # front instead: the compiled alloy binary then inherits a valid interpreter
  # and rpath and is self-contained. We must NOT autoPatchelf the compiled
  # output itself, as that would shift the offsets in denort's appended trailer.
  denort = stdenv.mkDerivation {
    pname = "denort";
    version = deno.version;
    src = fetchurl {
      url = "https://dl.deno.land/release/v${deno.version}/denort-${denoTarget}.zip";
      hash = denortHash;
    };
    nativeBuildInputs = [
      unzip
      autoPatchelfHook
    ];
    buildInputs = [ stdenv.cc.cc.lib ]; # libgcc_s.so.1
    sourceRoot = ".";
    dontConfigure = true;
    dontBuild = true;
    installPhase = ''
      runHook preInstall
      install -Dm755 denort "$out/bin/denort"
      runHook postInstall
    '';
  };
  denortBin = "${denort}/bin/denort";

  # Fixed-output derivation: the only step allowed network access. Fetches and
  # vendors every dependency so the real build can run fully offline with
  # --cached-only. The probe compile guarantees the vendor tree is complete.
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
      export DENORT_BIN="${denortBin}"
      mkdir -p "$HOME" "$DENO_DIR"

      deno install --frozen --vendor=true
      deno compile \
        --vendor=true \
        --unstable-sloppy-imports \
        --frozen \
        --target ${denoTarget} \
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

      mkdir -p "$out"
      cp -R vendor "$out/vendor"
      cp -R node_modules "$out/node_modules"

      runHook postInstall
    '';
  };
in
assert lib.assertMsg (deno.version == denortDenoVersion) ''
  alloy: denortHash is pinned to Deno ${denortDenoVersion}, but Deno ${deno.version}
  is in scope. Build against Alloy's pinned nixpkgs (do not set
  inputs.alloy.inputs.nixpkgs.follows), or bump denortDenoVersion + denortHash
  together after refreshing the denort download.
'';
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
    export DENORT_BIN="${denortBin}"
    mkdir -p "$HOME" "$DENO_DIR"
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
      --target ${denoTarget} \
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
      --prefix PATH : "${lib.makeBinPath [ imagemagick which ]}" \
      --set-default NODE_ENV production \
      --set-default WEB_DIST_DIR "$out/share/alloy/web" \
      --set-default ALLOY_MIGRATIONS_DIR "$out/share/alloy/migrations" \
      --set-default FFMPEG_BIN "${jellyfin-ffmpeg}/bin/ffmpeg" \
      --set-default FFPROBE_BIN "${jellyfin-ffmpeg}/bin/ffprobe"

    runHook postInstall
  '';

  passthru = {
    inherit denoDeps denort;
  };

  meta = {
    description = "Open-source and self-hostable alternative to Medal.tv";
    homepage = "https://github.com/zekurio/alloy";
    license = lib.licenses.agpl3Only;
    mainProgram = "alloy";
    platforms = [ "x86_64-linux" ];
  };
}
