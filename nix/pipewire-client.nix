# The PipeWire client that OBS and Electron load: libpipewire, with the
# modules and SPA plugins client.conf has a client open, copied out of
# nixpkgs' PipeWire. The rest of PipeWire is the daemon's, and its Bluetooth,
# camera, GStreamer and network audio support bring in over 300 MiB, Python
# among it.
{
  lib,
  stdenvNoCC,
  pipewire,
}:

let
  # `context.modules` in client.conf.
  modules = [
    "rt"
    "protocol-native"
    "client-node"
    "client-device"
    "adapter"
    "metadata"
    "session-manager"
  ];
  # The context loads support and D-Bus, which the rt module asks RTKit
  # through. The adapter wraps every audio and video stream in a converter,
  # and input ports mix their links, as when OBS captures several
  # applications in one stream. Logs go to stderr rather than the journal,
  # whose plugin brings in systemd.
  plugins = [
    "support/libspa-support.so"
    "support/libspa-dbus.so"
    "audioconvert/libspa-audioconvert.so"
    "videoconvert/libspa-videoconvert.so"
    "audiomixer/libspa-audiomixer.so"
    "control/libspa-control.so"
  ];
in
stdenvNoCC.mkDerivation {
  # libpipewire has the paths of PipeWire's folders compiled in, which are
  # rewritten in place to this package's. With PipeWire's name, its path has
  # the same length.
  pname = "pipewire";
  inherit (pipewire) version;

  dontUnpack = true;
  dontBuild = true;
  dontPatchELF = true;
  dontStrip = true;

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/pipewire-0.3 $out/share/pipewire
    cp -P ${pipewire}/lib/libpipewire-0.3.so* $out/lib/
    for module in ${lib.escapeShellArgs modules}; do
      cp ${pipewire}/lib/pipewire-0.3/libpipewire-module-$module.so $out/lib/pipewire-0.3/
    done
    for plugin in ${lib.escapeShellArgs plugins}; do
      install -D ${pipewire}/lib/spa-0.2/$plugin $out/lib/spa-0.2/$plugin
    done
    cp ${pipewire}/share/pipewire/client.conf $out/share/pipewire/
    chmod -R u+w $out
    find $out -type f -exec sed -i "s|${pipewire}|$out|g" {} +

    runHook postInstall
  '';

  disallowedReferences = [ pipewire ];

  meta = {
    description = "PipeWire client libraries for the Alloy desktop app";
    inherit (pipewire.meta) homepage license;
    platforms = lib.platforms.linux;
  };
}
