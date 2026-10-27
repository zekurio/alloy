{ self }:

{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.programs.alloy-desktop;

  # Built from the system's nixpkgs rather than the flake's: Electron and
  # libobs load the system's graphics drivers, which need a glibc at least as
  # new as the one they were built with. The pnpm dependencies still come
  # from the flake, whose fetcher their hash is checked against.
  alloy-obs-runtime = pkgs.callPackage "${self}/nix/obs-runtime.nix" { };
  defaultPackage = pkgs.callPackage "${self}/nix/desktop.nix" {
    inherit alloy-obs-runtime;
    inherit (self.packages.${pkgs.stdenv.hostPlatform.system}.alloy) pnpmDeps;
  };
in
{
  options.programs.alloy-desktop = {
    enable = lib.mkEnableOption "the Alloy desktop app, which records game clips with OBS";

    package = lib.mkOption {
      type = lib.types.package;
      default = defaultPackage;
      defaultText = lib.literalMD "`alloy-desktop` built from the system's nixpkgs";
      description = ''
        The Alloy desktop package. The default needs a nixpkgs from 26.05 on;
        with older ones, use the flake's `packages.''${system}.alloy-desktop`.
      '';
    };

    gameCapture.enable = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Install obs-vkcapture's Vulkan layer for 64- and 32-bit games and set
        `OBS_VKCAPTURE=1` for the session, so the recorder captures a game's
        own frames instead of the whole screen. Without it, game sessions
        fall back to display capture. The layer only sends frames while a
        capture source is listening.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    environment.systemPackages = [ cfg.package ];

    hardware.graphics = lib.mkIf cfg.gameCapture.enable {
      extraPackages = [ pkgs.obs-studio-plugins.obs-vkcapture ];
      extraPackages32 = [ pkgs.pkgsi686Linux.obs-studio-plugins.obs-vkcapture ];
    };
    environment.sessionVariables = lib.mkIf cfg.gameCapture.enable {
      OBS_VKCAPTURE = "1";
    };
  };
}
