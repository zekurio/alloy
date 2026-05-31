from __future__ import annotations

import threading

from alloy_ml.config import Settings

from .game_classifier import GameClassifier, GameClassifierSpec


class ModelRegistry:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.lock = threading.Lock()
        self.game_classifiers: dict[str, GameClassifier] = {}

    def get_game_classifier(self, spec: GameClassifierSpec) -> GameClassifier:
        with self.lock:
            cached = self.game_classifiers.get(spec.cache_key)
            if cached is not None:
                return cached
            model = GameClassifier(self.settings, spec)
            self.game_classifiers[spec.cache_key] = model
            return model

    def loaded_game_classifiers(self) -> list[GameClassifier]:
        with self.lock:
            return list(self.game_classifiers.values())
