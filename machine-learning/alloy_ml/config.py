from __future__ import annotations

import concurrent.futures
import logging
import os
import re
import sys
from pathlib import Path
from socket import socket

from gunicorn.arbiter import Arbiter
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from rich.console import Console
from rich.logging import RichHandler
from uvicorn import Server
from uvicorn.workers import UvicornWorker


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="MACHINE_LEARNING_",
        case_sensitive=False,
        protected_namespaces=("settings_",),
    )

    cache_folder: Path = Path("/cache")
    workers: int = 1
    worker_timeout: int = 300
    http_keepalive_timeout_s: int = 2
    request_threads: int = os.cpu_count() or 4
    device: str = "auto"
    game_classifier_checkpoint: Path | None = None
    game_classifier_repo_id: str = "zekurio/alloy-game-clip-efficientnet-b2-v1-broad"
    game_classifier_filename: str = "alloy-game-clip-efficientnet-b2-v1-broad.pt"
    game_classifier_revision: str = "main"
    game_classifier_name: str = "alloy-game-classifier"
    game_classifier_version: str | None = None
    game_classifier_top_k: int = Field(default=1, ge=1)
    preload_game_classifier: bool = False


class NonPrefixedSettings(BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=False)

    alloy_ml_host: str = "0.0.0.0"
    alloy_ml_port: int = 3003
    alloy_ml_log_level: str = "info"
    no_color: bool = False


LOG_LEVELS: dict[str, int] = {
    "critical": logging.ERROR,
    "error": logging.ERROR,
    "warning": logging.WARNING,
    "warn": logging.WARNING,
    "info": logging.INFO,
    "log": logging.INFO,
    "debug": logging.DEBUG,
    "verbose": logging.DEBUG,
}

settings = Settings()
non_prefixed_settings = NonPrefixedSettings()

LOG_LEVEL = LOG_LEVELS.get(
    non_prefixed_settings.alloy_ml_log_level.lower(), logging.INFO
)

_clean_name_pattern = re.compile(r"[^A-Za-z0-9_.-]+")


def clean_model_name(value: str) -> str:
    token = value.rstrip("/").split("/")[-1]
    cleaned = _clean_name_pattern.sub("_", token).strip("._-")
    return cleaned or "model"


class CustomRichHandler(RichHandler):
    def __init__(self) -> None:
        console = Console(
            color_system="standard",
            no_color=non_prefixed_settings.no_color,
        )
        self.excluded = ["uvicorn", "starlette", "fastapi"]
        super().__init__(
            show_path=False,
            omit_repeated_times=False,
            console=console,
            rich_tracebacks=True,
            tracebacks_suppress=[*self.excluded, concurrent.futures],
            tracebacks_show_locals=LOG_LEVEL == logging.DEBUG,
        )

    def emit(self, record: logging.LogRecord) -> None:
        if record.exc_info is not None:
            traceback = record.exc_info[2]
            while traceback is not None:
                if any(
                    excluded in traceback.tb_frame.f_code.co_filename
                    for excluded in self.excluded
                ):
                    traceback.tb_frame.f_locals["_rich_traceback_omit"] = True
                traceback = traceback.tb_next

        return super().emit(record)


logging.basicConfig(
    level=LOG_LEVEL,
    format="%(message)s",
    datefmt="[%X]",
    handlers=[CustomRichHandler()],
)
log = logging.getLogger("ml.log")
log.setLevel(LOG_LEVEL)


class CustomUvicornServer(Server):
    async def shutdown(self, sockets: list[socket] | None = None) -> None:
        for sock in sockets or []:
            sock.close()
        await super().shutdown()


class CustomUvicornWorker(UvicornWorker):
    async def _serve(self) -> None:
        self.config.app = self.wsgi
        server = CustomUvicornServer(config=self.config)
        self._install_sigquit_handler()
        await server.serve(sockets=self.sockets)
        if not server.started:
            sys.exit(Arbiter.WORKER_BOOT_ERROR)
