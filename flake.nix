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
      version = (builtins.fromJSON (builtins.readFile ./package.json)).version;
    in
    flake-utils.lib.eachSystem systems (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        alloy = pkgs.callPackage ./nix/package.nix { inherit version; };
      in
      {
        # The dev environment lives in devenv.nix (https://devenv.sh); this flake
        # is the packaging/CI/NixOS entrypoint only.
        packages = {
          default = alloy;
          inherit alloy;
        };

        checks.default = alloy;
      }
    )
    // {
      nixosModules.default = import ./nix/module.nix { inherit self; };
    };
}
