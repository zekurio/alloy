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
      || name == ".env"
      || name == ".git"
      || name == ".pg"
      || name == ".venv"
      || name == "__pycache__"
      || name == "build"
      || name == "data"
      || name == "dist"
      || name == "node_modules"
      || lib.hasSuffix ".pyc" (toString path)
    );
}
