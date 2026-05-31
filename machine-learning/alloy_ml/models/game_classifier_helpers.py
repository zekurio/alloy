import io
from pathlib import Path
from shutil import rmtree
from typing import Any

import torch
from PIL import Image, UnidentifiedImageError
from torchvision import transforms

from alloy_ml.config import clean_model_name

from .errors import ClassifierUnavailableError, InvalidFrameError

IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)


def load_checkpoint(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise ClassifierUnavailableError(f"Checkpoint does not exist: {path}")
    try:
        return torch.load(path, map_location="cpu", weights_only=False)
    except TypeError:
        return torch.load(path, map_location="cpu")


def clean_revision_name(revision: str) -> str:
    cleaned = clean_model_name(revision)
    if len(cleaned) == 40 and all(char in "0123456789abcdef" for char in cleaned):
        return cleaned[:7]
    return cleaned


def remove_dir_if_exists(path: Path) -> None:
    if path.exists():
        rmtree(path)


def resolve_device(spec: str) -> torch.device:
    if spec != "auto":
        return torch.device(spec)
    if torch.cuda.is_available():
        return torch.device("cuda")
    mps = getattr(torch.backends, "mps", None)
    if mps is not None and mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def make_transform(image_size: int, normalize: bool):
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


def sample_frames(frames: list[Image.Image], count: int) -> list[Image.Image]:
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
