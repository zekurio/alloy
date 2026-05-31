from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from functools import partial
from typing import Any, AsyncGenerator, Callable

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import ORJSONResponse, PlainTextResponse
from starlette.formparsers import MultiPartParser

from alloy_ml.config import log, settings
from alloy_ml.models.game_classifier import (
    ClassifierUnavailableError,
    GameClassifier,
    InvalidFrameError,
)
from alloy_ml.schemas import GameClassifierResponse, GamePrediction, HealthResponse

MultiPartParser.spool_max_size = 2**26

classifier = GameClassifier(settings)
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
    response = HealthResponse(
        status="ok",
        classifierLoaded=classifier.loaded,
        checkpointCached=classifier.checkpoint_cached,
        checkpointPath=str(classifier.resolved_checkpoint_path),
        checkpointSource=classifier.checkpoint_source,
    )
    return ORJSONResponse(response.model_dump(by_alias=True))


@app.post("/predict")
@app.post("/v1/game-classifier/predict")
async def predict_game(
    frames: list[UploadFile] = File(...),
    top_k: int | None = Form(default=None),
) -> ORJSONResponse:
    if top_k is not None and not 1 <= top_k <= 20:
        raise HTTPException(400, "top_k must be between 1 and 20")

    payloads: list[bytes] = []
    for frame in frames:
        payload = await frame.read()
        payloads.append(payload)

    try:
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


async def run(func: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    if thread_pool is None:
        return func(*args, **kwargs)
    partial_func = partial(func, *args, **kwargs)
    return await asyncio.get_running_loop().run_in_executor(thread_pool, partial_func)
