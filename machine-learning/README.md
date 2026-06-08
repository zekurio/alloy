# Alloy Machine Learning

Optional Python inference service for Alloy. Today it provides advisory game
classification for uploaded clips; predictions are suggestions, not an automatic
source of truth for `clip.gameId`.

The service is intentionally separate from the Node server so it can have its
own Python dependency graph, runtime cache, workers, device selection, and
container image.

## Layout

```text
machine-learning/
  alloy_ml/                 Python package for the HTTP service
    main.py                 FastAPI app and route handlers
    config.py               environment parsing
    schemas.py              request/response models
    models/                 model registry and classifier implementation
  scripts/healthcheck.py    container healthcheck
  Dockerfile                alloy-machine-learning image
  pyproject.toml            uv project metadata and dependencies
  uv.lock                   locked Python dependencies
```

## Commands

From `machine-learning/`:

```bash
uv sync --extra cpu
uv run python -m alloy_ml
uv run python scripts/healthcheck.py
```

From the repository root:

```bash
pnpm dev:ml
```

`pnpm dev:ml` starts the server, web app, and ML service. It keeps runtime model
data in `data/ml`. Use `MACHINE_LEARNING_UV_SYNC=0 pnpm dev:ml` after the first
sync if you want to restart without re-running `uv sync`.

Build the CPU container image:

```bash
docker build -t alloy-machine-learning:local machine-learning
```

The release workflow publishes `ghcr.io/zekurio/alloy-machine-learning`.

## Runtime Contract

`GET /ping`

Returns `pong` when the HTTP process is alive.

`GET /health`

Returns readiness metadata, including whether the configured classifier
checkpoint is cached locally.

`POST /predict`

Multipart form endpoint. Send JPEG or PNG frames using repeated `frames` fields.
Optional fields: `model_name`, `model_version`, `repo_id`, `filename`,
`revision`, and `checkpoint_path`.

The response is ranked, confidence-scored, and advisory:

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

| Variable                                           | Default                                    | Description                                         |
| -------------------------------------------------- | ------------------------------------------ | --------------------------------------------------- |
| `ALLOY_ML_HOST`                                    | `0.0.0.0`                                  | Bind host                                           |
| `ALLOY_ML_PORT`                                    | `2662`                                     | Bind port                                           |
| `ALLOY_ML_LOG_LEVEL`                               | `info`                                     | Log level                                           |
| `MACHINE_LEARNING_CACHE_FOLDER`                    | `/cache`                                   | Runtime cache root                                  |
| `MACHINE_LEARNING_GAME_CLASSIFIER_REPO_ID`         | `zekurio/alloy-clipnet-b2-v1`              | Hugging Face model repo                             |
| `MACHINE_LEARNING_GAME_CLASSIFIER_FILENAME`        | `alloy-clipnet-b2-v1.pt`                   | Checkpoint file inside the Hugging Face repo        |
| `MACHINE_LEARNING_GAME_CLASSIFIER_REVISION`        | `05b8d2af2b704a21366e58e9fd6bef5cef2847cb` | Hugging Face revision, tag, branch, or commit       |
| `MACHINE_LEARNING_GAME_CLASSIFIER_CHECKPOINT`      | unset                                      | Optional local checkpoint override                  |
| `MACHINE_LEARNING_GAME_CLASSIFIER_NAME`            | `alloy-game-classifier`                    | Response model name                                 |
| `MACHINE_LEARNING_GAME_CLASSIFIER_VERSION`         | `alloy-clipnet-b2-v1`                      | Response model version                              |
| `MACHINE_LEARNING_GAME_CLASSIFIER_TOP_K`           | `5`                                        | Number of ranked predictions                        |
| `MACHINE_LEARNING_GAME_CLASSIFIER_MAX_FRAMES`      | `16`                                       | Maximum direct-service frame count per request      |
| `MACHINE_LEARNING_GAME_CLASSIFIER_MAX_FRAME_BYTES` | `1048576`                                  | Maximum direct-service bytes per frame              |
| `MACHINE_LEARNING_PRELOAD_GAME_CLASSIFIER`         | `false`                                    | Download and load the classifier at startup         |
| `MACHINE_LEARNING_DEVICE`                          | `auto`                                     | `auto`, `cpu`, `cuda`, or `mps`                     |
| `MACHINE_LEARNING_WORKERS`                         | `1`                                        | Gunicorn worker count                               |
| `MACHINE_LEARNING_REQUEST_THREADS`                 | host CPU count                             | Thread pool size for blocking decode/inference work |
| `HF_TOKEN`                                         | unset                                      | Optional Hugging Face token for private model repos |

## Model Cache

The checkpoint is downloaded lazily by `huggingface_hub` on first classifier
load. It is reused from:

```text
MACHINE_LEARNING_CACHE_FOLDER/game-classification/<model>__<revision>/classifier/model.pt
```

The adjacent `source.json` records repo, filename, and revision. If that source
changes, Alloy clears and redownloads the model folder.

The Docker image intentionally does not bake a checkpoint. Set
`MACHINE_LEARNING_PRELOAD_GAME_CLASSIFIER=true` if you want startup to download
and load the configured model before the first request.

## Server Integration

The Node server can pass a classifier model reference per request. That lets
Alloy runtime config adjust the model without restarting the ML service. The
registry keeps one in-memory classifier per repo/revision/filename or local
checkpoint path. Environment variables define the direct-service default.
