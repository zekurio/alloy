{
  description = "alloy";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      ...
    }:
    let
      systems = [ "x86_64-linux" ];
      version = (builtins.fromJSON (builtins.readFile ./deno.json)).version;
    in
    flake-utils.lib.eachSystem systems (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        alloy = pkgs.callPackage ./nix/package.nix { inherit version; };
        alloy-machine-learning = pkgs.callPackage ./nix/machine-learning.nix { inherit version; };
        alloy-image = pkgs.callPackage ./nix/docker.nix { inherit alloy version; };
      in
      {
        # The dev environment lives in devenv.nix (https://devenv.sh); this flake
        # is the packaging/CI/NixOS entrypoint only.
        packages = {
          default = alloy;
          inherit alloy alloy-machine-learning alloy-image;
        };

        checks.default = alloy;
      }
    )
    // {
      nixosModules.default = import ./nix/module.nix { inherit self; };
    };
}
