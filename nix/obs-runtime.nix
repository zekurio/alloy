# The OBS runtime the desktop recorder loads on Linux, as one prefix:
# libobs with its modules and muxer helper, obs-vkcapture for game capture,
# obs-pipewire-audio-capture for application audio, and libpulse for the
# audio inventory and level meters. The recorder finds it through
# `ALLOY_OBS_RUNTIME_DIR`.
{
  lib,
  symlinkJoin,
  obs-studio,
  obs-studio-plugins,
  libpulseaudio,
}:

symlinkJoin {
  name = "alloy-obs-runtime-${obs-studio.version}";
  paths = [
    obs-studio
    obs-studio-plugins.obs-vkcapture
    obs-studio-plugins.obs-pipewire-audio-capture
    libpulseaudio
  ];

  meta = {
    description = "OBS runtime for the Alloy desktop recorder";
    platforms = lib.platforms.linux;
  };
}
