from __future__ import annotations

import io
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from huggingface_hub import snapshot_download
import torch
from PIL import Image, UnidentifiedImageError
from torchvision import transforms

from alloy_ml.config import Settings, clean_model_name, log

from .clip_cnn import ClipCnnConfig, build_clip_cnn

IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)


class ClassifierUnavailableError(RuntimeError):
    pass


class InvalidFrameError(ValueError):
    pass


@dataclass(frozen=True)
class Prediction:
    label: str
    score: float


@dataclass(frozen=True)
class PredictionResult:
    model_name: str
    model_version: str | None
    predictions: list[Prediction]


class GameClassifier:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.checkpoint_path: Path | None = settings.game_classifier_checkpoint
        self.repo_id = settings.game_classifier_repo_id
        self.filename = settings.game_classifier_filename
        self.revision = settings.game_classifier_revision
        self.model_name = settings.game_classifier_name
        self.configured_model_version = settings.game_classifier_version
        self.default_top_k = settings.game_classifier_top_k
        self.max_frame_width = settings.game_classifier_max_frame_width
        self.max_frame_height = settings.game_classifier_max_frame_height
        self.max_frame_pixels = settings.game_classifier_max_frame_pixels
        self.device = _resolve_device(settings.device)
        self.lock = threading.Lock()
        self.model: torch.nn.Module | None = None
        self.classes: list[str] = []
        self.model_version: str | None = None
        self.expected_frames = 12
        self.image_size = 224
        self.normalize = True
        self.transform = _make_transform(self.image_size, self.normalize)

    @property
    def loaded(self) -> bool:
        return self.model is not None

    @property
    def checkpoint_cached(self) -> bool:
        return self.resolved_checkpoint_path.is_file()

    @property
    def resolved_checkpoint_path(self) -> Path:
        if self.checkpoint_path is not None:
            return self.checkpoint_path
        return self.cache_dir / self.filename

    @property
    def cache_dir(self) -> Path:
        return (
            self.settings.cache_folder
            / "game-classifier"
            / clean_model_name(self.repo_id)
        )

    @property
    def checkpoint_source(self) -> str:
        return (
            str(self.checkpoint_path)
            if self.checkpoint_path is not None and self.checkpoint_path.is_file()
            else f"hf://{self.repo_id}@{self.revision}/{self.filename}"
        )

    def predict_bytes(
        self,
        frame_payloads: list[bytes],
        *,
        top_k: int | None = None,
    ) -> PredictionResult:
        frames = [
            decode_frame(
                payload,
                max_width=self.max_frame_width,
                max_height=self.max_frame_height,
                max_pixels=self.max_frame_pixels,
            )
            for payload in frame_payloads
        ]
        return self.predict(frames, top_k=top_k)

    def predict(
        self,
        frames: list[Image.Image],
        *,
        top_k: int | None = None,
    ) -> PredictionResult:
        if not frames:
            raise InvalidFrameError("At least one frame is required")

        self.load()
        if self.model is None:
            raise ClassifierUnavailableError("Game classifier failed to load")

        limit = min(top_k or self.default_top_k, len(self.classes))
        selected_frames = _sample_frames(frames, self.expected_frames)
        tensor = torch.stack([self.transform(frame) for frame in selected_frames])
        tensor = tensor.unsqueeze(0).to(self.device)

        with torch.inference_mode():
            logits = self.model(tensor)
            probs = torch.softmax(logits.detach().float(), dim=1)[0].cpu()

        scores, indices = torch.topk(probs, k=limit)
        predictions = [
            Prediction(label=self.classes[int(index)], score=float(score))
            for score, index in zip(scores.tolist(), indices.tolist(), strict=True)
        ]
        return PredictionResult(
            model_name=self.model_name,
            model_version=self.model_version,
            predictions=predictions,
        )

    def load(self) -> None:
        if self.model is not None:
            return

        with self.lock:
            if self.model is not None:
                return
            checkpoint_path = self.resolve_checkpoint_path()
            checkpoint = _load_checkpoint(checkpoint_path)
            model_config_payload = dict(checkpoint["model_config"])
            model_config_payload["pretrained"] = False
            model_config = ClipCnnConfig(**model_config_payload)
            classes = list(checkpoint["classes"])
            if not classes:
                raise ClassifierUnavailableError("Checkpoint has no classes")

            model = build_clip_cnn(model_config).to(self.device)
            model.load_state_dict(checkpoint["model"])
            model.eval()

            train_config = dict(checkpoint.get("train_config", {}))
            self.expected_frames = int(train_config.get("num_frames", 12))
            self.image_size = int(train_config.get("image_size", 224))
            self.normalize = bool(train_config.get("normalize", True))
            self.transform = _make_transform(self.image_size, self.normalize)
            self.classes = classes
            self.model_version = self.configured_model_version or self.revision
            self.model = model

    def resolve_checkpoint_path(self) -> Path:
        checkpoint_path = self.resolved_checkpoint_path
        if checkpoint_path.is_file():
            self.checkpoint_path = checkpoint_path
            return checkpoint_path

        try:
            log.info(
                "Downloading game classifier model "
                f"'{self.repo_id}' to {self.cache_dir}. This may take a while."
            )
            snapshot_download(
                self.repo_id,
                revision=self.revision,
                cache_dir=self.cache_dir,
                local_dir=self.cache_dir,
            )
        except Exception as err:
            raise ClassifierUnavailableError(
                "Could not download game classifier checkpoint from "
                f"Hugging Face repo {self.repo_id}: {err}"
            ) from err

        if not checkpoint_path.is_file():
            raise ClassifierUnavailableError(
                "Downloaded game classifier repo did not contain "
                f"checkpoint file {self.filename}"
            )

        self.checkpoint_path = checkpoint_path
        return checkpoint_path


def _load_checkpoint(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise ClassifierUnavailableError(f"Checkpoint does not exist: {path}")
    try:
        return torch.load(path, map_location="cpu", weights_only=False)
    except TypeError:
        return torch.load(path, map_location="cpu")


def _resolve_device(spec: str) -> torch.device:
    if spec != "auto":
        return torch.device(spec)
    if torch.cuda.is_available():
        return torch.device("cuda")
    mps = getattr(torch.backends, "mps", None)
    if mps is not None and mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def _make_transform(image_size: int, normalize: bool):
    steps: list[Any] = [
        transforms.Resize((image_size, image_size)),
        transforms.ToTensor(),
    ]
    if normalize:
        steps.append(transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD))
    return transforms.Compose(steps)


def decode_frame(
    payload: bytes,
    *,
    max_width: int,
    max_height: int,
    max_pixels: int,
) -> Image.Image:
    if not payload:
        raise InvalidFrameError("Frame payload is empty")
    try:
        with Image.open(io.BytesIO(payload)) as image:
            _validate_frame_dimensions(
                image.width,
                image.height,
                max_width=max_width,
                max_height=max_height,
                max_pixels=max_pixels,
            )
            return image.convert("RGB")
    except Image.DecompressionBombError as err:
        raise InvalidFrameError("Frame dimensions are too large") from err
    except UnidentifiedImageError as err:
        raise InvalidFrameError("Frame is not a readable image") from err


def _validate_frame_dimensions(
    width: int,
    height: int,
    *,
    max_width: int,
    max_height: int,
    max_pixels: int,
) -> None:
    if width <= 0 or height <= 0:
        raise InvalidFrameError("Frame has zero width or height")
    if width > max_width or height > max_height:
        raise InvalidFrameError(
            f"Frame dimensions {width}x{height} exceed the maximum "
            f"{max_width}x{max_height}"
        )
    pixels = width * height
    if pixels > max_pixels:
        raise InvalidFrameError(
            f"Frame has {pixels} pixels, exceeding the maximum {max_pixels}"
        )


def _sample_frames(frames: list[Image.Image], count: int) -> list[Image.Image]:
    if count <= 0:
        raise InvalidFrameError("Expected frame count must be positive")
    if len(frames) == count:
        return frames
    if len(frames) > count:
        if count == 1:
            return [frames[(len(frames) - 1) // 2]]
        return [
            frames[round(index * (len(frames) - 1) / (count - 1))]
            for index in range(count)
        ]
    return [*frames, *([frames[-1]] * (count - len(frames)))]
