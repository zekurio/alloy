from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from functools import partial
from typing import Any, AsyncGenerator, Callable

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import ORJSONResponse, PlainTextResponse
from starlette.formparsers import MultiPartException, MultiPartParser

from alloy_ml.config import log, settings
from alloy_ml.models.game_classifier import (
    ClassifierUnavailableError,
    GameClassifier,
    InvalidFrameError,
)
from alloy_ml.schemas import GameClassifierResponse, GamePrediction, HealthResponse

MultiPartParser.spool_max_size = 2**26
_multipart_parser_init = MultiPartParser.__init__
_multipart_parser_on_part_data = MultiPartParser.on_part_data


def install_multipart_limits() -> None:
    def limited_init(
        self: MultiPartParser,
        *args: Any,
        max_files: int | float = 1000,
        max_fields: int | float = 1000,
        max_part_size: int = 1024 * 1024,
        **kwargs: Any,
    ) -> None:
        _multipart_parser_init(
            self,
            *args,
            max_files=min(max_files, settings.game_classifier_max_frames),
            max_fields=max_fields,
            max_part_size=max_part_size,
            **kwargs,
        )
        self._alloy_part_bytes = 0

    def limited_on_part_data(
        self: MultiPartParser,
        data: bytes,
        start: int,
        end: int,
    ) -> None:
        chunk_size = end - start
        total_size = getattr(self, "_alloy_part_bytes", 0) + chunk_size
        if total_size > settings.game_classifier_max_request_bytes:
            raise MultiPartException("Frame payload exceeds maximum size.")
        self._alloy_part_bytes = total_size

        current_file = self._current_part.file
        if current_file is not None:
            current_size = current_file.size or 0
            if current_size + chunk_size > settings.game_classifier_max_frame_bytes:
                raise MultiPartException("Frame exceeds maximum size.")

        _multipart_parser_on_part_data(self, data, start, end)

    MultiPartParser.__init__ = limited_init
    MultiPartParser.on_part_data = limited_on_part_data


install_multipart_limits()

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


@app.middleware("http")
async def reject_oversized_requests(request: Request, call_next: Callable[..., Any]):
    if request.url.path not in {"/predict", "/v1/game-classifier/predict"}:
        return await call_next(request)

    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            byte_length = int(content_length)
        except ValueError:
            byte_length = -1
        if (
            byte_length < 0
            or byte_length > settings.game_classifier_max_request_bytes
        ):
            return ORJSONResponse(
                {"detail": "Frame payload exceeds maximum size."},
                status_code=413,
            )

    return await call_next(request)


@app.exception_handler(MultiPartException)
async def multipart_exception_handler(
    _: Request,
    exc: MultiPartException,
) -> ORJSONResponse:
    detail = str(exc)
    status_code = (
        413
        if detail.startswith("Frame ")
        or detail.startswith("Too many files")
        or "maximum size" in detail
        else 400
    )
    return ORJSONResponse({"detail": detail}, status_code=status_code)


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
    if len(frames) > settings.game_classifier_max_frames:
        raise HTTPException(
            413,
            f"Expected at most {settings.game_classifier_max_frames} frames.",
        )

    payloads: list[bytes] = []
    for frame in frames:
        if (
            frame.size is not None
            and frame.size > settings.game_classifier_max_frame_bytes
        ):
            raise HTTPException(413, "Frame exceeds maximum size.")
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
