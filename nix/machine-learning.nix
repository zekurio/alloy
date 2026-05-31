{
  lib,
  makeWrapper,
  python3,
  version ? (builtins.fromJSON (builtins.readFile ../deno.json)).version,
  source ? import ./source.nix {
    inherit lib;
    root = ../.;
  },
}:

let
  python = python3.override {
    self = python;
  };

  dependencies = with python.pkgs; [
    fastapi
    gunicorn
    huggingface-hub
    numpy
    orjson
    pillow
    pydantic
    pydantic-settings
    python-multipart
    rich
    torch
    torchvision
    uvicorn
  ] ++ python.pkgs.uvicorn.optional-dependencies.standard;
in
python.pkgs.buildPythonApplication {
  pname = "alloy-machine-learning";
  inherit version;
  src = "${source}/machine-learning";
  pyproject = true;

  build-system = with python.pkgs; [
    hatchling
  ];

  inherit dependencies;

  nativeBuildInputs = [
    makeWrapper
  ];

  pythonImportsCheck = [
    "alloy_ml"
  ];

  doCheck = false;

  postInstall = ''
    mkdir -p "$out/share/alloy-machine-learning"
    cp alloy_ml/log_conf.json "$out/share/alloy-machine-learning/log_conf.json"
  '';

  postFixup = ''
    wrapProgram "$out/bin/alloy-machine-learning" \
      --prefix PATH : ${lib.makeBinPath [ python.pkgs.gunicorn ]} \
      --prefix PYTHONPATH : "$out/${python.sitePackages}:${python.pkgs.makePythonPath dependencies}" \
      --set-default ALLOY_ML_HOST 127.0.0.1 \
      --set-default ALLOY_ML_PORT 3003 \
      --set-default HF_HOME /var/cache/alloy/machine-learning/huggingface \
      --set-default HF_HUB_CACHE /var/cache/alloy/machine-learning/huggingface/hub \
      --set-default HF_HUB_DISABLE_PROGRESS_BARS 1 \
      --set-default HOME /var/cache/alloy/machine-learning \
      --set-default MACHINE_LEARNING_CACHE_FOLDER /var/cache/alloy/machine-learning \
      --set-default MACHINE_LEARNING_WORKERS 1 \
      --set-default MACHINE_LEARNING_WORKER_TIMEOUT 300 \
      --set-default XDG_CACHE_HOME /var/cache/alloy/machine-learning
  '';

  meta = {
    description = "Alloy machine learning inference service";
    homepage = "https://github.com/zekurio/alloy/tree/main/machine-learning";
    license = lib.licenses.agpl3Only;
    mainProgram = "alloy-machine-learning";
    platforms = [ "x86_64-linux" ];
  };
}
