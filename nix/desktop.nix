{
  lib,
  rustPlatform,
  nodejs_24,
  pnpm_11,
  pnpmConfigHook,
  pkg-config,
  wrapGAppsHook3,
  alsa-lib,
  glib-networking,
  gst_all_1,
  gtk3,
  libayatana-appindicator,
  librsvg,
  libsoup_3,
  openssl,
  webkitgtk_4_1,
  ffmpeg-headless,
  ffmpegPackage ? ffmpeg-headless,
  gpu-screen-recorder,
  version ? (builtins.fromJSON (builtins.readFile ../package.json)).version,
  source ? import ./source.nix {
    inherit lib;
    root = ../.;
  },
  # The workspace dependency store, shared with the server package.
  pnpmDeps,
}:

let
  pnpmPackage = import ./pnpm.nix { inherit pnpm_11; };
in
rustPlatform.buildRustPackage {
  pname = "alloy-desktop";
  inherit version pnpmDeps;
  src = source;

  cargoLock.lockFile = ../Cargo.lock;

  nativeBuildInputs = [
    nodejs_24
    pnpmPackage
    pnpmConfigHook
    pkg-config
    wrapGAppsHook3
  ];

  buildInputs = [
    alsa-lib
    glib-networking
    gtk3
    librsvg
    libsoup_3
    openssl
    webkitgtk_4_1
  ]
  # WebKitGTK plays the clips in the library through GStreamer.
  ++ (with gst_all_1; [
    gstreamer
    gst-plugins-base
    gst-plugins-good
    gst-plugins-bad
    gst-libav
  ]);

  cargoBuildFlags = [
    "--package"
    "alloy-desktop"
    "--package"
    "alloy-agent"
  ];
  # Serves the embedded renderer instead of a dev server, as `tauri build` does.
  buildFeatures = [ "alloy-desktop/custom-protocol" ];
  # The crates have no unit tests.
  doCheck = false;

  preBuild = ''
    export HOME="$TMPDIR/home"
    export TURBO_TELEMETRY_DISABLED=1
    export DO_NOT_TRACK=1
    mkdir -p "$HOME"

    pnpm --filter @alloy/desktop build:renderer
  '';

  # Tauri looks for resources in ../lib/<productName> beside the executable,
  # which is where the host starts the agent from.
  postInstall = ''
    install -Dm755 "$out/bin/alloy-agent" "$out/lib/Alloy/agent/alloy-agent"
    rm "$out/bin/alloy-agent"

    install -Dm644 packages/desktop/linux/dev.zekurio.alloy.desktop \
      "$out/share/applications/dev.zekurio.alloy.desktop"
    install -Dm644 public/logo.png "$out/share/icons/hicolor/512x512/apps/dev.zekurio.alloy.png"
    install -Dm644 LICENSE "$out/share/doc/alloy-desktop/LICENSE"
  '';

  # The agent records with gpu-screen-recorder and the host processes captures
  # with FFmpeg, both found on PATH. The tray icon library is loaded at run
  # time.
  preFixup = ''
    gappsWrapperArgs+=(
      --prefix PATH : "${
        lib.makeBinPath [
          gpu-screen-recorder
          ffmpegPackage
        ]
      }"
      --prefix LD_LIBRARY_PATH : "${lib.makeLibraryPath [ libayatana-appindicator ]}"
    )
  '';

  # The NixOS module installs gpu-screen-recorder's KMS helper from the same
  # package, since the recorder and the helper must match.
  passthru = { inherit gpu-screen-recorder; };

  meta = {
    description = "Desktop app for Alloy that records gameplay clips";
    homepage = "https://github.com/zekurio/alloy";
    license = lib.licenses.mit;
    mainProgram = "alloy-desktop";
    platforms = [ "x86_64-linux" ];
  };
}
