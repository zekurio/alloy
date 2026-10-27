# The Alloy desktop app for Linux: the Electron shell, its native addon, the
# OBS recorder with the OBS runtime it loads, FFmpeg for the capture library,
# and a desktop entry. Graphics drivers come from the system; nix/README.md
# lists what else has to.
{
  lib,
  stdenvNoCC,
  rustPlatform,
  makeWrapper,
  writeShellScriptBin,
  makeDesktopItem,
  copyDesktopItems,
  nodejs_24,
  pnpm_11,
  pnpmConfigHook,
  pkg-config,
  alsa-lib,
  glib,
  callPackage,
  ffmpeg-headless,
  alloy-obs-runtime,
  # The server package's dependency fetch: one workspace lockfile, one hash.
  pnpmDeps,
  version ? (builtins.fromJSON (builtins.readFile ../package.json)).version,
  source ? import ./source.nix {
    inherit lib;
    root = ../.;
  },
}:

let
  pnpmPackage = import ./pnpm.nix { inherit pnpm_11; };
  electron = callPackage ./electron.nix { };

  # The Rust and the Electron builds each see only their own files, so a
  # change to one, or to the server or web app, doesn't rebuild the other.
  rustFiles = lib.fileset.unions [
    ../Cargo.toml
    ../Cargo.lock
    ../packages/desktop/host
    ../packages/desktop/native
    ../packages/desktop/recorder
    ../packages/desktop/update-signer
  ];
  repository = lib.fileset.fromSource source;

  # The recorder sidecar and the Node-API addon, from one workspace build.
  native = rustPlatform.buildRustPackage {
    pname = "alloy-desktop-native";
    inherit version;
    src = lib.fileset.toSource {
      root = ../.;
      # The host plays the notification sounds in assets/.
      fileset = lib.fileset.intersection repository (
        lib.fileset.union rustFiles ../packages/desktop/assets
      );
    };
    cargoLock.lockFile = ../Cargo.lock;
    cargoBuildFlags = [
      "--package"
      "alloy-agent"
      "--package"
      "alloy-desktop-native"
    ];
    nativeBuildInputs = [ pkg-config ];
    # Notification sounds play through ALSA.
    buildInputs = [ alsa-lib ];
    # The workspace tests need FFmpeg and a display; CI runs them.
    doCheck = false;
    # The agent opens GLib by name for the screen-sharing portal's main loop,
    # before anything it links has loaded it.
    postFixup = ''
      patchelf --add-rpath ${lib.makeLibraryPath [ glib ]} "$out/bin/alloy-agent"
    '';
  };

  # The main process, preloads and connect screen, bundled by electron-vite.
  # The bundles ship no node_modules.
  shell = stdenvNoCC.mkDerivation {
    pname = "alloy-desktop-shell";
    inherit version pnpmDeps;
    src = lib.fileset.toSource {
      root = ../.;
      fileset = lib.fileset.difference repository rustFiles;
    };
    nativeBuildInputs = [
      nodejs_24
      pnpmPackage
      pnpmConfigHook
    ];
    env.ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
    buildPhase = ''
      runHook preBuild
      export HOME="$TMPDIR/home"
      mkdir -p "$HOME"
      pnpm --filter @alloy/desktop build:shell
      runHook postBuild
    '';
    installPhase = ''
      runHook preInstall
      cp -R packages/desktop/out "$out"
      runHook postInstall
    '';
  };

  appId = "dev.zekurio.alloy";

  # Electron opens links and folders with xdg-open, and this one comes first
  # on the path. The browser or file manager it starts doesn't get Electron's
  # CHROME_DESKTOP, which Chromium-based browsers would take as their own
  # desktop entry.
  xdgOpen = writeShellScriptBin "xdg-open" ''
    unset CHROME_DESKTOP
    PATH=:$PATH:
    PATH=''${PATH//":''${0%/*}:"/:}
    PATH=''${PATH#:}
    PATH=''${PATH%:}
    exec xdg-open "$@"
  '';
in
stdenvNoCC.mkDerivation {
  pname = "alloy-desktop";
  inherit version;
  dontUnpack = true;

  nativeBuildInputs = [
    makeWrapper
    copyDesktopItems
  ];

  # The agent is copied, not linked: OBS starts its muxer helper from the
  # folder of the running executable, which a link would resolve away from.
  # Shrinking its run path would drop GLib, and its build already stripped it.
  dontPatchELF = true;
  dontStrip = true;

  desktopItems = [
    (makeDesktopItem {
      # The shortcuts portal identifies Alloy by this name, which also is
      # the Wayland app id package.json's `desktopName` gives the window.
      name = appId;
      desktopName = "Alloy";
      comment = "Record and share game clips";
      exec = "alloy-desktop";
      icon = appId;
      startupWMClass = appId;
      categories = [
        "AudioVideo"
        "Recorder"
      ];
      # For desktops without the GlobalShortcuts portal: bind these to keys.
      actions = {
        clip = {
          name = "Save a clip";
          exec = "alloy-desktop --action clip";
        };
        screenshot = {
          name = "Take a screenshot";
          exec = "alloy-desktop --action screenshot";
        };
      };
    })
  ];

  # Laid out like the repository, which is where the shell looks when run
  # by a separate Electron: `resources/` beside its package.json, and the
  # tray icon at `public/logo.png` two folders up.
  installPhase = ''
    runHook preInstall

    app="$out/lib/alloy-desktop/packages/desktop"
    resources="$app/resources"
    mkdir -p "$resources/agent" "$resources/native"

    cp -R ${shell} "$app/out"
    install -Dm644 ${source}/packages/desktop/package.json "$app/package.json"
    install -Dm644 ${source}/public/logo.png "$out/lib/alloy-desktop/public/logo.png"

    install -Dm755 ${native}/lib/liballoy_desktop_native.so "$resources/native/alloy-desktop.node"
    install -Dm755 ${native}/bin/alloy-agent "$resources/agent/alloy-agent"
    ln -s ${alloy-obs-runtime}/bin/obs-ffmpeg-mux "$resources/agent/obs-ffmpeg-mux"
    # The host hands the agent this folder; it loads libobs, its plugins and
    # libpipewire from there.
    ln -s ${alloy-obs-runtime} "$resources/obs-runtime"

    install -Dm644 ${source}/public/logo.png \
      "$out/share/icons/hicolor/512x512/apps/${appId}.png"

    makeWrapper ${lib.getExe electron} "$out/bin/alloy-desktop" \
      --add-flags "$app" \
      --prefix PATH : ${xdgOpen}/bin \
      --set-default ALLOY_FFMPEG ${lib.getExe' ffmpeg-headless "ffmpeg"} \
      --set-default ALLOY_FFPROBE ${lib.getExe' ffmpeg-headless "ffprobe"}

    runHook postInstall
  '';

  passthru = {
    inherit electron native shell;
  };

  meta = {
    description = "Alloy desktop app: game clips recorded with OBS";
    homepage = "https://github.com/zekurio/alloy";
    license = lib.licenses.mit;
    mainProgram = "alloy-desktop";
    platforms = [ "x86_64-linux" ];
  };
}
