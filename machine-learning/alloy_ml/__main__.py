from __future__ import annotations

import signal
import subprocess
import sys
from ipaddress import ip_address
from pathlib import Path

from .config import log, non_prefixed_settings, settings


def _is_ipv6(host: str) -> bool:
    try:
        return ip_address(host).version == 6
    except ValueError:
        return False


def main() -> int:
    log.info("Initializing Alloy machine learning")

    module_dir = Path(__file__).parent
    bind_host = non_prefixed_settings.alloy_ml_host
    if _is_ipv6(bind_host):
        bind_host = f"[{bind_host}]"
    bind_address = f"{bind_host}:{non_prefixed_settings.alloy_ml_port}"

    process: subprocess.Popen[bytes] | None = None
    try:
        with subprocess.Popen(
            [
                sys.executable,
                "-m",
                "gunicorn",
                "alloy_ml.main:app",
                "-k",
                "alloy_ml.config.CustomUvicornWorker",
                "-c",
                str(module_dir / "gunicorn_conf.py"),
                "-b",
                bind_address,
                "-w",
                str(settings.workers),
                "-t",
                str(settings.worker_timeout),
                "--log-config-json",
                str(module_dir / "log_conf.json"),
                "--keep-alive",
                str(settings.http_keepalive_timeout_s),
                "--graceful-timeout",
                "10",
            ]
        ) as process:
            process.wait()
    except KeyboardInterrupt:
        if process is not None:
            process.send_signal(signal.SIGINT)

    return process.returncode if process is not None else 1


if __name__ == "__main__":
    raise SystemExit(main())
