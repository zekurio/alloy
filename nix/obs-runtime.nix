# The OBS runtime the desktop recorder loads on Linux, as one prefix:
# libobs with the modules the recorder opens and the muxer helper,
# obs-vkcapture for game capture, obs-pipewire-audio-capture for device and
# application audio, and the libpipewire it links, which the recorder also
# loads for the audio inventory and level meters. The recorder finds it
# through `ALLOY_OBS_RUNTIME_DIR`.
#
# Like the Windows runtime, it holds only what the recorder loads. The files
# are copied out of nixpkgs' OBS, so they still come from the binary cache,
# but without the rest of OBS: its UI, browser source, scripting and VLC
# source bring in Qt, CEF, Python and VLC, over 2 GiB in all.
{
  lib,
  stdenvNoCC,
  obs-studio,
  obs-studio-plugins,
  pipewire,
  patchelf,
  removeReferencesTo,
}:

let
  # `platform_modules` in packages/desktop/recorder/src/agent/obs/platform/linux.rs.
  modules = [
    "obs-ffmpeg"
    "obs-x264"
    "obs-outputs"
    "obs-nvenc"
    "obs-qsv11"
    "linux-capture"
    "linux-pipewire"
  ];
  plugins = [
    obs-studio-plugins.obs-vkcapture
    obs-studio-plugins.obs-pipewire-audio-capture
  ];
in
stdenvNoCC.mkDerivation {
  pname = "alloy-obs-runtime";
  inherit (obs-studio) version;

  dontUnpack = true;
  dontBuild = true;
  # The libraries keep OBS's run paths, /run/opengl-driver/lib included,
  # which a shrink would drop since it doesn't exist in the sandbox.
  dontPatchELF = true;
  dontStrip = true;

  nativeBuildInputs = [
    patchelf
    removeReferencesTo
  ];

  installPhase = ''
    runHook preInstall

    mkdir -p $out/bin $out/lib/obs-plugins $out/share/obs/obs-plugins
    # obs-vkcapture links the frontend API, whose calls do nothing without
    # OBS's UI.
    cp -P ${obs-studio}/lib/libobs{,-opengl,-frontend-api}.so* $out/lib/
    cp -r ${obs-studio}/share/obs/libobs $out/share/obs/
    # Without the wrapper OBS's UI runs its helpers in, whose environment
    # names Qt and VLC.
    for helper in obs-ffmpeg-mux obs-nvenc-test; do
      cp ${obs-studio}/bin/.$helper-wrapped $out/bin/$helper
    done
    for module in ${lib.escapeShellArgs modules}; do
      cp ${obs-studio}/lib/obs-plugins/$module.so $out/lib/obs-plugins/
      if [ -d ${obs-studio}/share/obs/obs-plugins/$module ]; then
        cp -r ${obs-studio}/share/obs/obs-plugins/$module $out/share/obs/obs-plugins/
      fi
    done
    for plugin in ${lib.escapeShellArgs plugins}; do
      cp $plugin/lib/obs-plugins/*.so $out/lib/obs-plugins/
      cp -r $plugin/share/obs/obs-plugins/. $out/share/obs/obs-plugins/
    done
    ln -s ${lib.getLib pipewire}/lib/libpipewire-0.3.so.0 $out/lib/
    chmod -R u+w $out

    # The modules find libobs through OBS's own lib folder; point them at
    # this one, and drop OBS's compiled-in paths, which the recorder
    # replaces with this prefix's.
    for file in $out/lib/*.so.* $out/lib/obs-plugins/*.so $out/bin/*; do
      [ -L "$file" ] && continue
      rpath=$(patchelf --print-rpath "$file")
      patchelf --set-rpath "''${rpath//"${obs-studio}/lib"/$out/lib}" "$file"
      remove-references-to -t ${obs-studio} "$file"
    done

    runHook postInstall
  '';

  disallowedReferences = [ obs-studio ];

  meta = {
    description = "OBS runtime for the Alloy desktop recorder";
    platforms = lib.platforms.linux;
  };
}
