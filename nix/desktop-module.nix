{ self }:

{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.programs.alloy-desktop;
in
{
  options.programs.alloy-desktop = {
    enable = lib.mkEnableOption "the Alloy desktop app";

    package = lib.mkOption {
      type = lib.types.package;
      default =
        self.packages.${pkgs.stdenv.hostPlatform.system}.alloy-desktop
          or (throw "alloy-desktop only packages x86_64-linux for now");
      defaultText = lib.literalExpression "alloy.packages.\${pkgs.stdenv.hostPlatform.system}.alloy-desktop";
      description = "The Alloy desktop package to install.";
    };
  };

  config = lib.mkIf cfg.enable {
    environment.systemPackages = [ cfg.package ];

    # gpu-screen-recorder captures monitors through KMS. The module installs
    # its KMS helper with the capability that needs, so recording starts
    # without an authentication prompt. The helper must come from the same
    # package as the recorder the app runs.
    programs.gpu-screen-recorder = {
      enable = true;
      package = cfg.package.gpu-screen-recorder;
    };
  };
}
