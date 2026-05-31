import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from functools import partial
from pathlib import Path
from typing import Any, AsyncGenerator, Callable

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse

from alloy_ml.config import log, settings
from alloy_ml.models.game_classifier import (
    ClassifierUnavailableError,
    GameClassifierSpec,
    InvalidFrameError,
)
from alloy_ml.models.registry import ModelRegistry
from alloy_ml.schemas import (
    GameClassifierResponse,
    GamePrediction,
    HealthModel,
    HealthResponse,
)

default_game_classifier_spec = GameClassifierSpec(
    model_name=settings.game_classifier_name,
    model_version=settings.game_classifier_version,
    repo_id=settings.game_classifier_repo_id,
    filename=settings.game_classifier_filename,
    revision=settings.game_classifier_revision,
    checkpoint_path=settings.game_classifier_checkpoint,
)
model_registry = ModelRegistry(settings)
thread_pool: ThreadPoolExecutor | None = None


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None, None]:
    global thread_pool
    log.info(
        "ML service configuration: "
        f"cache={settings.cache_folder}, device={settings.device}, "
        f"workers={settings.workers}, request_threads={settings.request_threads}, "
        f"preload_game_classifier={settings.preload_game_classifier}"
    )
    log.info(
        "Default game classifier: "
        f"name={default_game_classifier_spec.model_name}, "
        f"version={default_game_classifier_spec.model_version}, "
        f"repo={default_game_classifier_spec.repo_id}, "
        f"filename={default_game_classifier_spec.filename}, "
        f"revision={default_game_classifier_spec.revision}, "
        f"checkpoint_override={default_game_classifier_spec.checkpoint_path}"
    )
    if settings.request_threads > 0:
        thread_pool = ThreadPoolExecutor(settings.request_threads)
        log.info(
            "Initialized request thread pool with "
            f"{settings.request_threads} threads."
        )
    try:
        if settings.preload_game_classifier:
            log.info("Preloading game classifier model.")
            classifier = model_registry.get_game_classifier(default_game_classifier_spec)
            await run(classifier.load)
        yield
    finally:
        if thread_pool is not None:
            thread_pool.shutdown()


app = FastAPI(lifespan=lifespan)


@app.get("/")
async def root() -> dict[str, str]:
    return {"message": "Alloy machine learning"}


@app.get("/ping")
def ping() -> PlainTextResponse:
    return PlainTextResponse("pong")


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    default_classifier = model_registry.get_game_classifier(default_game_classifier_spec)
    loaded_classifiers = model_registry.loaded_game_classifiers()
    log.info(
        "Health check: "
        f"default_loaded={default_classifier.loaded}, "
        f"default_cached={default_classifier.checkpoint_cached}, "
        f"registered_classifiers={len(loaded_classifiers)}"
    )
    return HealthResponse(
        status="ok",
        classifierLoaded=default_classifier.loaded,
        checkpointCached=default_classifier.checkpoint_cached,
        checkpointPath=str(default_classifier.resolved_checkpoint_path),
        checkpointSource=default_classifier.checkpoint_source,
        models=[
            HealthModel(
                kind="game-classifier",
                modelName=model.spec.model_name,
                modelVersion=model.spec.model_version or model.spec.revision,
                loaded=model.loaded,
                checkpointCached=model.checkpoint_cached,
                checkpointPath=str(model.resolved_checkpoint_path),
                checkpointSource=model.checkpoint_source,
            )
            for model in loaded_classifiers
        ],
    )


@app.post("/predict", response_model=GameClassifierResponse)
@app.post("/v1/game-classifier/predict", response_model=GameClassifierResponse)
async def predict_game(
    frames: list[UploadFile] = File(...),
    model_name: str | None = Form(default=None),
    model_version: str | None = Form(default=None),
    repo_id: str | None = Form(default=None),
    filename: str | None = Form(default=None),
    revision: str | None = Form(default=None),
    checkpoint_path: str | None = Form(default=None),
) -> GameClassifierResponse:
    payloads: list[bytes] = []
    for frame in frames:
        payload = await frame.read()
        payloads.append(payload)
    total_bytes = sum(len(payload) for payload in payloads)
    log.info(
        "Game classifier request received: "
        f"frames={len(payloads)}, bytes={total_bytes}, "
        f"repo_override={_optional_string(repo_id)}, "
        f"filename_override={_optional_string(filename)}, "
        f"revision_override={_optional_string(revision)}, "
        f"checkpoint_override={_optional_string(checkpoint_path)}"
    )

    try:
        spec = make_game_classifier_spec(
            model_name=model_name,
            model_version=model_version,
            repo_id=repo_id,
            filename=filename,
            revision=revision,
            checkpoint_path=checkpoint_path,
        )
        classifier = model_registry.get_game_classifier(spec)
        result = await run(classifier.predict_bytes, payloads)
    except InvalidFrameError as err:
        raise HTTPException(400, str(err)) from err
    except ClassifierUnavailableError as err:
        raise HTTPException(503, str(err)) from err

    response = GameClassifierResponse(
        modelName=result.model_name,
        modelVersion=result.model_version,
        predictions=[
            GamePrediction(label=prediction.label, score=prediction.score)
            for prediction in result.predictions
        ],
    )
    if response.predictions:
        top = response.predictions[0]
        log.info(
            "Game classifier response ready: "
            f"model={response.model_name}, version={response.model_version}, "
            f"top_label={top.label}, top_score={top.score:.4f}, "
            f"predictions={len(response.predictions)}"
        )
    else:
        log.info(
            "Game classifier response ready: "
            f"model={response.model_name}, version={response.model_version}, "
            "predictions=0"
        )
    return response


def make_game_classifier_spec(
    *,
    model_name: str | None,
    model_version: str | None,
    repo_id: str | None,
    filename: str | None,
    revision: str | None,
    checkpoint_path: str | None,
) -> GameClassifierSpec:
    clean_checkpoint_path = _optional_string(checkpoint_path)
    overrides: dict[str, Any] = {
        "model_name": _optional_string(model_name),
        "repo_id": _optional_string(repo_id),
        "filename": _optional_string(filename),
        "revision": _optional_string(revision),
        "checkpoint_path": Path(clean_checkpoint_path)
        if clean_checkpoint_path is not None
        else None,
        "clear_checkpoint_path": checkpoint_path is not None
        and clean_checkpoint_path is None,
    }
    if model_version is not None:
        overrides["model_version"] = _optional_string(model_version)
    return default_game_classifier_spec.with_overrides(**overrides)


def _optional_string(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


async def run(func: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    if thread_pool is None:
        return func(*args, **kwargs)
    partial_func = partial(func, *args, **kwargs)
    return await asyncio.get_running_loop().run_in_executor(thread_pool, partial_func)
