# `pkgs.pnpm` is a moving alias. Alloy pins pnpm 11.24.0, whose Node-based
# nixpkgs builder accepts `version` and `hash`; pnpm 12 uses the Rust builder
# and accepts `srcHash` and `cargoHash` instead. Target the pinned major so a
# nixpkgs default change cannot alter the override interface.
{ pnpm_11 }:

pnpm_11.override {
  version = "11.24.0";
  hash = "sha256-0eqyQzFyZhzDahjshfzpP3cdsZYnFzKcwB7JwoJMok8=";
}
