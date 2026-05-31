from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import torch
from torch import nn
from torchvision.models import (
    efficientnet_b0,
    efficientnet_b2,
    resnet18,
    resnet34,
    resnet50,
)

CnnArch = Literal[
    "resnet18",
    "resnet34",
    "resnet50",
    "efficientnet_b0",
    "efficientnet_b2",
]
TemporalPool = Literal["mean", "max"]


@dataclass(frozen=True)
class ClipCnnConfig:
    num_classes: int
    arch: CnnArch = "resnet18"
    pretrained: bool = False
    dropout: float = 0.0
    temporal_pool: TemporalPool = "mean"
    frame_batch_size: int | None = 32


class ClipCnnClassifier(nn.Module):
    def __init__(self, config: ClipCnnConfig) -> None:
        super().__init__()
        self.config = config
        self.backbone, feature_dim = build_torchvision_backbone(config.arch)
        self.classifier = nn.Sequential(
            nn.Dropout(config.dropout) if config.dropout > 0 else nn.Identity(),
            nn.Linear(feature_dim, config.num_classes),
        )

    def forward(self, frames: torch.Tensor) -> torch.Tensor:
        if frames.ndim == 4:
            frames = frames.unsqueeze(1)
        if frames.ndim != 5:
            raise ValueError(
                f"expected frames shaped [B, T, C, H, W], got {tuple(frames.shape)}"
            )

        batch_size, steps, channels, height, width = frames.shape
        flat = frames.reshape(batch_size * steps, channels, height, width)
        features = self._encode_frames(flat).reshape(batch_size, steps, -1)

        if self.config.temporal_pool == "mean":
            pooled = features.mean(dim=1)
        elif self.config.temporal_pool == "max":
            pooled = features.max(dim=1).values
        else:
            raise ValueError(f"unknown temporal_pool: {self.config.temporal_pool}")

        return self.classifier(pooled)

    def _encode_frames(self, frames: torch.Tensor) -> torch.Tensor:
        frame_batch_size = self.config.frame_batch_size
        if frame_batch_size is None or frame_batch_size <= 0:
            return self.backbone(frames)
        if frames.shape[0] <= frame_batch_size:
            return self.backbone(frames)
        return torch.cat(
            [self.backbone(chunk) for chunk in frames.split(frame_batch_size)],
            dim=0,
        )


def build_torchvision_backbone(arch: CnnArch) -> tuple[nn.Module, int]:
    if arch == "resnet18":
        model = resnet18(weights=None)
        feature_dim = model.fc.in_features
        model.fc = nn.Identity()
    elif arch == "resnet34":
        model = resnet34(weights=None)
        feature_dim = model.fc.in_features
        model.fc = nn.Identity()
    elif arch == "resnet50":
        model = resnet50(weights=None)
        feature_dim = model.fc.in_features
        model.fc = nn.Identity()
    elif arch == "efficientnet_b0":
        model = efficientnet_b0(weights=None)
        feature_dim = model.classifier[-1].in_features
        model.classifier = nn.Identity()
    elif arch == "efficientnet_b2":
        model = efficientnet_b2(weights=None)
        feature_dim = model.classifier[-1].in_features
        model.classifier = nn.Identity()
    else:
        raise ValueError(f"unsupported torchvision architecture: {arch}")

    return model, feature_dim


def build_clip_cnn(config: ClipCnnConfig) -> ClipCnnClassifier:
    return ClipCnnClassifier(config)
