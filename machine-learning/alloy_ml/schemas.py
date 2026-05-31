from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class GamePrediction(BaseModel):
    label: str
    score: float


class GameClassifierResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    kind: Literal["game-suggestion"] = "game-suggestion"
    advisory: bool = True
    model_name: str = Field(alias="modelName")
    model_version: str | None = Field(default=None, alias="modelVersion")
    predictions: list[GamePrediction]


class HealthResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    status: Literal["ok"]
    classifier_loaded: bool = Field(alias="classifierLoaded")
    checkpoint_cached: bool = Field(alias="checkpointCached")
    checkpoint_path: str | None = Field(alias="checkpointPath")
    checkpoint_source: str = Field(alias="checkpointSource")
