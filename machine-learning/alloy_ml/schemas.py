from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

NonEmptyString = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1),
]


class GamePrediction(BaseModel):
    rank: int = Field(ge=1)
    label: NonEmptyString
    score: float = Field(ge=0, le=1, allow_inf_nan=False)


class GameClassifierResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    kind: Literal["game-suggestion"] = "game-suggestion"
    advisory: Literal[True] = True
    model_name: NonEmptyString = Field(alias="modelName")
    model_version: NonEmptyString | None = Field(default=None, alias="modelVersion")
    predictions: list[GamePrediction]

    @model_validator(mode="after")
    def validate_prediction_ranks(self) -> "GameClassifierResponse":
        for index, prediction in enumerate(self.predictions):
            if prediction.rank != index + 1:
                raise ValueError("prediction ranks must be sequential")
        return self


class HealthModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    kind: Literal["game-classifier"]
    model_name: NonEmptyString = Field(alias="modelName")
    model_version: NonEmptyString | None = Field(default=None, alias="modelVersion")
    loaded: bool
    checkpoint_cached: bool = Field(alias="checkpointCached")
    checkpoint_path: NonEmptyString | None = Field(alias="checkpointPath")
    checkpoint_source: NonEmptyString = Field(alias="checkpointSource")


class HealthResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    status: Literal["ok"]
    classifier_loaded: bool = Field(alias="classifierLoaded")
    checkpoint_cached: bool = Field(alias="checkpointCached")
    checkpoint_path: NonEmptyString | None = Field(alias="checkpointPath")
    checkpoint_source: NonEmptyString = Field(alias="checkpointSource")
    models: list[HealthModel] = Field(default_factory=list)
