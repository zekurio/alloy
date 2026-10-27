# The Electron release packages/desktop/package.json pins, so the Nix package
# and the dev shell run the Electron the Windows installer ships. nixpkgs
# packages only the releases it has caught up with. Built like nixpkgs'
# electron-bin: the upstream release, patched to run from the store.
{
  lib,
  stdenv,
  callPackage,
  fetchurl,
  unzip,
  makeWrapper,
  wrapGAppsHook3,
  alsa-lib,
  at-spi2-atk,
  cairo,
  cups,
  dbus,
  expat,
  gdk-pixbuf,
  glib,
  gtk3,
  libdrm,
  libgbm,
  libGL,
  libnotify,
  libpulseaudio,
  libsecret,
  libva,
  libx11,
  libxcb,
  libxcomposite,
  libxdamage,
  libxext,
  libxfixes,
  libxkbcommon,
  libxkbfile,
  libxrandr,
  libxshmfence,
  nspr,
  nss,
  pango,
  pciutils,
  speechd-minimal,
  systemdMinimal,
  vulkan-loader,
}:

let
  version = (lib.importJSON ../packages/desktop/package.json).devDependencies.electron;

  # Electron loads some of these by name at run time, so they go on its run
  # path rather than being found from what it links. Without libva, Chromium
  # decodes video in software and can't play HEVC clips at all. Electron
  # links GTK 3 and doesn't load GTK 4, even with --gtk-version=4. libudev
  # comes from the minimal systemd that D-Bus already brings in.
  libraryPath = lib.makeLibraryPath [
    alsa-lib
    at-spi2-atk
    cairo
    cups
    dbus
    expat
    gdk-pixbuf
    glib
    gtk3
    libdrm
    libgbm
    libGL
    libnotify
    libpulseaudio
    libsecret
    libva
    libx11
    libxcb
    libxcomposite
    libxdamage
    libxext
    libxfixes
    libxkbcommon
    libxkbfile
    libxrandr
    libxshmfence
    nspr
    nss
    pango
    pciutils
    (callPackage ./pipewire-client.nix { })
    speechd-minimal
    stdenv.cc.cc
    systemdMinimal
    vulkan-loader
  ];

  # Chromium's UI strings, in the languages Alloy ships: `electronLanguages`
  # in packages/desktop/electron-builder.yml.
  languages = [
    "en-US"
    "de"
  ];
in
stdenv.mkDerivation {
  pname = "electron";
  inherit version;

  # When the pin moves, the build fails with the new release's hash.
  src = fetchurl {
    url = "https://github.com/electron/electron/releases/download/v${version}/electron-v${version}-linux-x64.zip";
    hash = "sha256-bn/S1FDUQlB7hGrOSubivRfhsWU+hqAztSMav8I+bfQ=";
  };

  nativeBuildInputs = [
    unzip
    makeWrapper
    wrapGAppsHook3
  ];
  buildInputs = [
    glib
    gtk3
  ];

  dontUnpack = true;
  dontBuild = true;
  # Only bin/electron is wrapped, not the files in libexec.
  dontWrapGApps = true;

  installPhase = ''
    runHook preInstall
    mkdir -p $out/libexec/electron
    unzip -d $out/libexec/electron $src -x 'locales/*'
    unzip -d $out/libexec/electron $src ${
      lib.escapeShellArgs (map (language: "locales/${language}.pak") languages)
    }
    chmod u-x $out/libexec/electron/*.so*
    runHook postInstall
  '';

  preFixup = ''
    makeWrapper "$out/libexec/electron/electron" $out/bin/electron \
      "''${gappsWrapperArgs[@]}"
  '';

  # Vulkan goes through nixpkgs' loader, which finds the system's drivers,
  # instead of the bundled one.
  postFixup = ''
    patchelf \
      --set-interpreter "$(cat $NIX_CC/nix-support/dynamic-linker)" \
      --set-rpath "${libraryPath}:$out/libexec/electron" \
      $out/libexec/electron/electron \
      $out/libexec/electron/chrome_crashpad_handler
    ln -sf ${lib.getLib vulkan-loader}/lib/libvulkan.so.1 $out/libexec/electron/libvulkan.so.1
  '';

  __structuredAttrs = true;
  strictDeps = true;

  meta = {
    description = "Electron, at the release the Alloy desktop app pins";
    homepage = "https://github.com/electron/electron";
    license = lib.licenses.mit;
    mainProgram = "electron";
    platforms = [ "x86_64-linux" ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
}
