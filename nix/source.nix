{
  lib,
  root,
}:

lib.cleanSourceWith {
  src = root;
  filter =
    path: _type:
    let
      name = baseNameOf path;
    in
    !(
      name == ".direnv"
      || name == ".devenv"
      || name == ".devenv.flake.nix"
      || name == ".env"
      || name == ".git"
      || name == ".pg"
      || name == ".turbo"
      || name == ".venv"
      || name == "__pycache__"
      || name == ".cache"
      || name == "build"
      || name == "data"
      || name == "devenv.local.nix"
      || name == "dist"
      || name == "nix"
      || name == "node_modules"
      || name == "release"
      || name == "resources"
      || name == "target"
      || lib.hasSuffix ".pyc" (toString path)
    );
}
