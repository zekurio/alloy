# The Electron release packages/desktop/package.json pins, so the Nix package
# and the dev shell run the Electron the Windows installer ships. nixpkgs
# packages only the releases it has caught up with. Built like nixpkgs'
# electron-bin: the upstream release, patched to run from the store.
{
  lib,
  stdenv,
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
  gtk4,
  libdrm,
  libgbm,
  libGL,
  libnotify,
  libpulseaudio,
  libsecret,
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
  pipewire,
  speechd-minimal,
  systemd,
  vulkan-loader,
}:

let
  version = (lib.importJSON ../packages/desktop/package.json).devDependencies.electron;

  # Electron loads some of these by name at run time, so they go on its run
  # path rather than being found from what it links.
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
    gtk4
    libdrm
    libgbm
    libGL
    libnotify
    libpulseaudio
    libsecret
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
    pipewire
    speechd-minimal
    stdenv.cc.cc
    systemd
    vulkan-loader
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
    gtk4
  ];

  dontUnpack = true;
  dontBuild = true;
  # Only bin/electron is wrapped, not the files in libexec.
  dontWrapGApps = true;

  installPhase = ''
    runHook preInstall
    mkdir -p $out/libexec/electron
    unzip -d $out/libexec/electron $src
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
