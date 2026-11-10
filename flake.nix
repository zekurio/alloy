{
  description = "Open-source and self-hostable alternative to Medal.tv";

  nixConfig = {
    extra-substituters = [ "https://zekurio.cachix.org" ];
    extra-trusted-public-keys = [
      "zekurio.cachix.org-1:mv0mACvSLZtBkXXh5YDPPXmFBJ/eO+VkSzep6LJZrAg="
    ];
  };

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    {
      self,
      nixpkgs,
      ...
    }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      alloy = pkgs.callPackage ./nix/package.nix { };
      alloy-obs-runtime = pkgs.callPackage ./nix/obs-runtime.nix { };
      alloy-desktop = pkgs.callPackage ./nix/desktop.nix {
        inherit alloy-obs-runtime;
        inherit (alloy) pnpmDeps;
      };
      dockerImage = pkgs.dockerTools.buildLayeredImage {
        name = "alloy";
        tag = alloy.version;
        contents = [ alloy ];
        config = {
          Cmd = [ "${pkgs.lib.getExe alloy}" ];
          ExposedPorts."2552/tcp" = { };
          # Uploads live under /data, a volume, so that they outlive the
          # container. Without these the server writes below its working
          # directory, the image's root.
          Env = [
            "ALLOY_STORAGE_FS_CLIPS_PATH=/data/clips"
            "ALLOY_STORAGE_FS_THUMBNAILS_PATH=/data/thumbnails"
            "ALLOY_STORAGE_FS_ASSETS_PATH=/data/assets"
          ];
          Volumes."/data" = { };
        };
      };
    in
    {
      packages.${system} = {
        default = alloy;
        inherit
          alloy
          alloy-desktop
          alloy-obs-runtime
          dockerImage
          ;
      };

      checks.${system} = {
        default = alloy;
        nixos-module-security = import ./nix/module-security-test.nix {
          inherit
            nixpkgs
            pkgs
            self
            system
            ;
        };
      };

      devShells.${system}.default = pkgs.callPackage ./nix/dev-shell.nix { };

      nixosModules.default = import ./nix/module.nix { inherit self; };
      nixosModules.desktop = import ./nix/desktop-module.nix { inherit self; };
    };
}
