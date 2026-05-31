from __future__ import annotations

import io
import json
import threading
from dataclasses import dataclass
from pathlib import Path
from shutil import copy2, rmtree
from typing import Any

from huggingface_hub import hf_hub_download
import torch
from PIL import Image, UnidentifiedImageError
from torchvision import transforms

from alloy_ml.config import Settings, clean_model_name, log

from .clip_cnn import ClipCnnConfig, build_clip_cnn

Image.MAX_IMAGE_PIXELS = None

IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)
CHECKPOINT_FILENAME = "model.pt"
SOURCE_METADATA_FILENAME = "source.json"
MODEL_TASK = "game-classification"
MODEL_TYPE = "classifier"
_UNSET = object()


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


@dataclass(frozen=True)
class GameClassifierSpec:
    model_name: str
    model_version: str | None
    repo_id: str
    filename: str
    revision: str
    checkpoint_path: Path | None = None

    @property
    def cache_key(self) -> str:
        if self.checkpoint_path is not None:
            return f"local:{self.checkpoint_path}"
        return f"hf:{self.repo_id}@{self.revision}/{self.filename}"

    def with_overrides(
        self,
        *,
        model_name: str | None = None,
        model_version: str | None | object = _UNSET,
        repo_id: str | None = None,
        filename: str | None = None,
        revision: str | None = None,
        checkpoint_path: Path | None = None,
        clear_checkpoint_path: bool = False,
    ) -> GameClassifierSpec:
        next_model_version = (
            self.model_version if model_version is _UNSET else model_version
        )
        return GameClassifierSpec(
            model_name=model_name or self.model_name,
            model_version=next_model_version
            if next_model_version is None or isinstance(next_model_version, str)
            else self.model_version,
            repo_id=repo_id or self.repo_id,
            filename=filename or self.filename,
            revision=revision or self.revision,
            checkpoint_path=None
            if clear_checkpoint_path
            else checkpoint_path or self.checkpoint_path,
        )


def game_classifier_spec_from_settings(settings: Settings) -> GameClassifierSpec:
    return GameClassifierSpec(
        model_name=settings.game_classifier_name,
        model_version=settings.game_classifier_version,
        repo_id=settings.game_classifier_repo_id,
        filename=settings.game_classifier_filename,
        revision=settings.game_classifier_revision,
        checkpoint_path=settings.game_classifier_checkpoint,
    )


class GameClassifier:
    def __init__(self, settings: Settings, spec: GameClassifierSpec) -> None:
        self.settings = settings
        self.spec = spec
        self.default_top_k = settings.game_classifier_top_k
        self.device = _resolve_device(settings.device)
        self.lock = threading.Lock()
        self.load_attempts = 0
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
        if self.spec.checkpoint_path is not None:
            return self.resolved_checkpoint_path.is_file()
        return (
            self.resolved_checkpoint_path.is_file()
            and self.source_metadata_matches()
        )

    @property
    def resolved_checkpoint_path(self) -> Path:
        if self.spec.checkpoint_path is not None:
            return self.spec.checkpoint_path
        return self.model_dir / CHECKPOINT_FILENAME

    @property
    def cache_dir(self) -> Path:
        return self.settings.cache_folder / MODEL_TASK / self.cache_model_name

    @property
    def model_dir(self) -> Path:
        return self.cache_dir / MODEL_TYPE

    @property
    def source_metadata_path(self) -> Path:
        return self.model_dir / SOURCE_METADATA_FILENAME

    @property
    def cache_model_name(self) -> str:
        repo_name = self.spec.repo_id.strip().removeprefix("https://huggingface.co/")
        repo_name = repo_name.rstrip("/").split("/")[-1]
        return clean_model_name(repo_name)

    @property
    def checkpoint_source(self) -> str:
        if self.spec.checkpoint_path is not None:
            return str(self.spec.checkpoint_path)
        return f"hf://{self.spec.repo_id}@{self.spec.revision}/{self.spec.filename}"

    def predict_bytes(
        self,
        frame_payloads: list[bytes],
        *,
        top_k: int | None = None,
    ) -> PredictionResult:
        frames = [decode_frame(payload) for payload in frame_payloads]
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
            model_name=self.spec.model_name,
            model_version=self.model_version,
            predictions=predictions,
        )

    def load(self) -> None:
        if self.model is not None:
            return

        with self.lock:
            if self.model is not None:
                return
            self.load_attempts += 1
            checkpoint_path = self.resolve_checkpoint_path()
            try:
                checkpoint = _load_checkpoint(checkpoint_path)
            except (EOFError, OSError, RuntimeError) as err:
                if self.spec.checkpoint_path is not None or self.load_attempts > 1:
                    raise
                log.warning(
                    "Failed to load cached game classifier checkpoint. "
                    "Clearing cache and downloading again.",
                    exc_info=True,
                )
                self.clear_cache()
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
            self.model_version = self.spec.model_version or self.spec.revision
            self.model = model

    def resolve_checkpoint_path(self) -> Path:
        checkpoint_path = self.resolved_checkpoint_path
        if self.spec.checkpoint_path is not None:
            if checkpoint_path.is_file():
                return checkpoint_path
            raise ClassifierUnavailableError(
                f"Configured game classifier checkpoint does not exist: {checkpoint_path}"
            )

        if checkpoint_path.is_file():
            if self.source_metadata_matches():
                return checkpoint_path
            log.info(
                "Cached game classifier checkpoint source does not match "
                "configuration. Clearing cache before download."
            )
            self.clear_cache()

        try:
            log.info(
                "Downloading game classifier model "
                f"'{self.spec.repo_id}' to {self.model_dir}. This may take a while."
            )
            download_dir = self.cache_dir / ".download"
            remove_dir_if_exists(download_dir)
            downloaded = hf_hub_download(
                repo_id=self.spec.repo_id,
                filename=self.spec.filename,
                revision=self.spec.revision,
                local_dir=download_dir,
            )
            self.model_dir.mkdir(parents=True, exist_ok=True)
            tmp_path = checkpoint_path.with_suffix(f"{checkpoint_path.suffix}.tmp")
            copy2(downloaded, tmp_path)
            tmp_path.replace(checkpoint_path)
            self.write_source_metadata()
            remove_dir_if_exists(download_dir)
        except Exception as err:
            remove_dir_if_exists(self.cache_dir / ".download")
            raise ClassifierUnavailableError(
                "Could not download game classifier checkpoint from "
                f"Hugging Face repo {self.spec.repo_id}: {err}"
            ) from err

        if not checkpoint_path.is_file():
            raise ClassifierUnavailableError(
                "Downloaded game classifier repo did not contain "
                f"checkpoint file {self.spec.filename}"
            )

        return checkpoint_path

    def source_metadata(self) -> dict[str, str]:
        return {
            "source": "hugging-face",
            "repoId": self.spec.repo_id,
            "filename": self.spec.filename,
            "revision": self.spec.revision,
        }

    def source_metadata_matches(self) -> bool:
        try:
            payload = json.loads(
                self.source_metadata_path.read_text(encoding="utf-8")
            )
        except (OSError, json.JSONDecodeError):
            return False
        if not isinstance(payload, dict):
            return False
        expected = self.source_metadata()
        return all(payload.get(key) == value for key, value in expected.items())

    def write_source_metadata(self) -> None:
        self.model_dir.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(self.source_metadata(), sort_keys=True)
        tmp_path = self.source_metadata_path.with_suffix(
            f"{self.source_metadata_path.suffix}.tmp"
        )
        tmp_path.write_text(f"{payload}\n", encoding="utf-8")
        tmp_path.replace(self.source_metadata_path)

    def clear_cache(self) -> None:
        if self.spec.checkpoint_path is not None:
            return
        if not self.cache_dir.exists():
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            return
        if not rmtree.avoids_symlink_attacks:
            raise ClassifierUnavailableError(
                "Could not safely clear model cache on this platform"
            )
        if self.cache_dir.is_dir():
            rmtree(self.cache_dir)
        else:
            self.cache_dir.unlink()
        self.cache_dir.mkdir(parents=True, exist_ok=True)


def _load_checkpoint(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise ClassifierUnavailableError(f"Checkpoint does not exist: {path}")
    try:
        return torch.load(path, map_location="cpu", weights_only=False)
    except TypeError:
        return torch.load(path, map_location="cpu")


def remove_dir_if_exists(path: Path) -> None:
    if path.exists():
        rmtree(path)


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


def decode_frame(payload: bytes) -> Image.Image:
    if not payload:
        raise InvalidFrameError("Frame payload is empty")
    try:
        with Image.open(io.BytesIO(payload)) as image:
            if image.width <= 0 or image.height <= 0:
                raise InvalidFrameError("Frame has zero width or height")
            return image.convert("RGB")
    except UnidentifiedImageError as err:
        raise InvalidFrameError("Frame is not a readable image") from err


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
