ARG DEVICE=cpu

FROM python:3.11-slim-bookworm AS builder

ARG DEVICE

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

WORKDIR /usr/src

RUN apt-get update \
  && apt-get install -y --no-install-recommends g++ \
  && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.8.15 /uv /uvx /bin/

COPY pyproject.toml README.md ./
COPY alloy_ml alloy_ml

RUN python -m venv /opt/venv \
  && uv sync --active --extra "${DEVICE}" --no-dev --compile-bytecode --no-progress --link-mode copy

FROM python:3.11-slim-bookworm AS prod

ENV ALLOY_ML_HOST=0.0.0.0 \
    ALLOY_ML_PORT=3003 \
    MACHINE_LEARNING_CACHE_FOLDER=/cache \
    HF_HOME=/cache/huggingface \
    HF_HUB_CACHE=/cache/huggingface/hub \
    HF_HUB_DISABLE_PROGRESS_BARS=1 \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/usr/src \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv

WORKDIR /usr/src

RUN apt-get update \
  && apt-get install -y --no-install-recommends tini libgomp1 \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /cache

COPY --from=builder /opt/venv /opt/venv
COPY scripts/healthcheck.py scripts/healthcheck.py
COPY alloy_ml alloy_ml

EXPOSE 3003

ENTRYPOINT ["tini", "--"]
CMD ["python", "-m", "alloy_ml"]

HEALTHCHECK CMD python scripts/healthcheck.py
