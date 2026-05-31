import threading

from alloy_ml.config import Settings, log

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
                log.info(
                    "Using registered game classifier: "
                    f"key={spec.cache_key}, loaded={cached.loaded}, "
                    f"checkpoint_cached={cached.checkpoint_cached}"
                )
                return cached
            log.info(
                "Registering game classifier: "
                f"key={spec.cache_key}, model={spec.model_name}, "
                f"version={spec.model_version}, checkpoint={spec.checkpoint_path}"
            )
            model = GameClassifier(self.settings, spec)
            self.game_classifiers[spec.cache_key] = model
            return model

    def loaded_game_classifiers(self) -> list[GameClassifier]:
        with self.lock:
            return list(self.game_classifiers.values())
