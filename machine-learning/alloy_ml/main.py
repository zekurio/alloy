from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from functools import partial
from pathlib import Path
from typing import Any, AsyncGenerator, Callable

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import ORJSONResponse, PlainTextResponse

from alloy_ml.config import log, settings
from alloy_ml.models.game_classifier import (
    ClassifierUnavailableError,
    GameClassifierSpec,
    InvalidFrameError,
    game_classifier_spec_from_settings,
)
from alloy_ml.models.registry import ModelRegistry
from alloy_ml.schemas import (
    GameClassifierResponse,
    GamePrediction,
    HealthModel,
    HealthResponse,
)

default_game_classifier_spec = game_classifier_spec_from_settings(settings)
model_registry = ModelRegistry(settings)
thread_pool: ThreadPoolExecutor | None = None


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None, None]:
    global thread_pool
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
async def root() -> ORJSONResponse:
    return ORJSONResponse({"message": "Alloy machine learning"})


@app.get("/ping")
def ping() -> PlainTextResponse:
    return PlainTextResponse("pong")


@app.get("/health")
def health() -> ORJSONResponse:
    default_classifier = model_registry.get_game_classifier(default_game_classifier_spec)
    loaded_classifiers = model_registry.loaded_game_classifiers()
    response = HealthResponse(
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
    return ORJSONResponse(response.model_dump(by_alias=True))


@app.post("/predict")
@app.post("/v1/game-classifier/predict")
async def predict_game(
    frames: list[UploadFile] = File(...),
    top_k: int | None = Form(default=None),
    model_name: str | None = Form(default=None),
    model_version: str | None = Form(default=None),
    repo_id: str | None = Form(default=None),
    filename: str | None = Form(default=None),
    revision: str | None = Form(default=None),
    checkpoint_path: str | None = Form(default=None),
) -> ORJSONResponse:
    if top_k is not None and top_k < 1:
        raise HTTPException(400, "top_k must be positive")

    payloads: list[bytes] = []
    for frame in frames:
        payload = await frame.read()
        payloads.append(payload)

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
        result = await run(classifier.predict_bytes, payloads, top_k=top_k)
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
    return ORJSONResponse(response.model_dump(by_alias=True))


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
