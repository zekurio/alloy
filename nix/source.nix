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
    # Exclude local state and generated output at every workspace depth.
    # Nix expressions configure the derivation, but are not build inputs.
    !(builtins.elem name [
      ".cache"
      ".direnv"
      ".env"
      ".git"
      ".venv"
      "__pycache__"
      "build"
      "data"
      "dist"
      "nix"
      "node_modules"
      "release"
      "resources"
      "target"
    ])
    && !(lib.hasSuffix ".pyc" name);
}
