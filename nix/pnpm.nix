{ pnpm_11 }:

let
  packageManager = (builtins.fromJSON (builtins.readFile ../package.json)).packageManager;
  pinnedVersion = builtins.match "pnpm@(11\\.[0-9]+\\.[0-9]+)" packageManager;
in
# Select the Node-based pnpm 11 builder, not the moving `pkgs.pnpm` alias.
# A major upgrade needs an explicit builder and dependency-hash review.
assert
  pinnedVersion != null
  || throw "Alloy's Nix package expects packageManager = pnpm@11.x.y; review nix/pnpm.nix before changing major versions.";
pnpm_11.override {
  version = builtins.head pinnedVersion;
  # Update this source hash alongside package.json's packageManager pin.
  hash = "sha256-0eqyQzFyZhzDahjshfzpP3cdsZYnFzKcwB7JwoJMok8=";
}
