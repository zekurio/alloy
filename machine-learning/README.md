# Alloy Machine Learning

This is the runtime inference service for Alloy, structured after Immich's
`machine-learning/` service: a top-level Python service, a package directory,
gunicorn/uvicorn entrypoint, Dockerfile, and a healthcheck script.

The first model is a game classifier. Its output is intentionally advisory:
Alloy should present predictions as user-selectable game suggestions, not as an
automatic source of truth for `clip.gameId`.

## Layout

```text
machine-learning/
  alloy_ml/              Python package for the HTTP service
    models/              Model loading and inference code
  scripts/healthcheck.py Container healthcheck
  Dockerfile             `alloy-machine-learning` image
  pyproject.toml         Python dependencies and package metadata
```

## Runtime Contract

`GET /ping`

Returns `pong` when the HTTP process is alive.

`GET /health`

Returns service readiness metadata, including whether the configured classifier
checkpoint has already been cached locally.

`POST /predict`

Multipart form endpoint. Send JPEG or PNG frames using the repeated `frames`
field. Optional form fields: `model_name`, `model_version`, `repo_id`,
`filename`, `revision`, and `checkpoint_path`.

The response is ranked, confidence-scored, and marked advisory:

```json
{
  "kind": "game-suggestion",
  "advisory": true,
  "modelName": "alloy-game-classifier",
  "modelVersion": "alloy-clipnet-b2-v1",
  "predictions": [
    { "rank": 1, "label": "valorant", "score": 0.94 },
    { "rank": 2, "label": "counter-strike-2", "score": 0.03 }
  ]
}
```

The same handler is also available at `/v1/game-classifier/predict` for a more
explicit server-to-server path.

## Configuration

Environment variables:

| Variable                                           | Default                                    | Description                                         |
| -------------------------------------------------- | ------------------------------------------ | --------------------------------------------------- |
| `ALLOY_ML_HOST`                                    | `0.0.0.0`                                  | Bind host                                           |
| `ALLOY_ML_PORT`                                    | `2662`                                     | Bind port                                           |
| `ALLOY_ML_LOG_LEVEL`                               | `info`                                     | Log level                                           |
| `MACHINE_LEARNING_CACHE_FOLDER`                    | `/cache`                                   | Runtime cache root                                  |
| `MACHINE_LEARNING_GAME_CLASSIFIER_REPO_ID`         | `zekurio/alloy-clipnet-b2-v1`              | Hugging Face model repo                             |
| `MACHINE_LEARNING_GAME_CLASSIFIER_FILENAME`        | `alloy-clipnet-b2-v1.pt`                   | Checkpoint file inside the Hugging Face repo        |
| `MACHINE_LEARNING_GAME_CLASSIFIER_REVISION`        | `05b8d2af2b704a21366e58e9fd6bef5cef2847cb` | Hugging Face revision, tag, branch, or commit       |
| `MACHINE_LEARNING_GAME_CLASSIFIER_CHECKPOINT`      | unset                                      | Optional local checkpoint override for development  |
| `MACHINE_LEARNING_GAME_CLASSIFIER_NAME`            | `alloy-game-classifier`                    | Response model name                                 |
| `MACHINE_LEARNING_GAME_CLASSIFIER_VERSION`         | `alloy-clipnet-b2-v1`                      | Response model version                              |
| `MACHINE_LEARNING_GAME_CLASSIFIER_TOP_K`           | `5`                                        | Number of ranked predictions to return              |
| `MACHINE_LEARNING_GAME_CLASSIFIER_MAX_FRAMES`      | `16`                                       | Maximum direct-service frame count per request      |
| `MACHINE_LEARNING_GAME_CLASSIFIER_MAX_FRAME_BYTES` | `1048576`                                  | Maximum direct-service bytes per frame              |
| `MACHINE_LEARNING_PRELOAD_GAME_CLASSIFIER`         | `false`                                    | Download and load the classifier at service startup |
| `MACHINE_LEARNING_DEVICE`                          | `auto`                                     | `auto`, `cpu`, `cuda`, or `mps`                     |
| `MACHINE_LEARNING_WORKERS`                         | `1`                                        | Gunicorn worker count                               |
| `MACHINE_LEARNING_REQUEST_THREADS`                 | host CPU count                             | Thread pool size for blocking decode/inference work |
| `HF_TOKEN`                                         | unset                                      | Optional Hugging Face token for private model repos |

## Local Run

Install with uv directly:

```bash
cd machine-learning
uv sync --extra cpu
MACHINE_LEARNING_CACHE_FOLDER=../data/ml uv run python -m alloy_ml
```

From the repository root, the equivalent first-class dev command is:

```bash
deno task dev:ml
```

It mirrors the direct command above and keeps ML runtime data in `data/ml`. Use
`ALLOY_ML_PORT` to change the local port, and use
`MACHINE_LEARNING_UV_SYNC=0 deno task dev:ml` after the first sync if you only
want to restart the service.

The checked-in Dockerfile currently targets CPU inference. CUDA/ROCm images can
be added as separate device variants later, following Immich's pattern.

The checkpoint is downloaded lazily by `huggingface_hub` on first classifier
load and reused from the Immich-style path
`MACHINE_LEARNING_CACHE_FOLDER/game-classification/<model>__<revision>/classifier/model.pt`
afterward. The adjacent `source.json` records the Hugging Face repo, filename,
and revision; if that source changes, Alloy clears and redownloads the model
folder. Set `MACHINE_LEARNING_PRELOAD_GAME_CLASSIFIER=true` to download and load
it during service startup. The Docker image intentionally does not bake the
checkpoint.

The app server can also pass a classifier model reference per request. This is
how Alloy's runtime config makes the model adjustable without restarting the ML
service: the registry keeps one in-memory classifier per repo/revision/filename
or local checkpoint path. A `MACHINE_LEARNING_*` environment variable still sets
the direct-service default, and the server-side runtime config controls what
normal upload suggestions use.
