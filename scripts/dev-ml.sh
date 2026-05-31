#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR/machine-learning"

: "${MACHINE_LEARNING_CACHE_FOLDER:=../data/ml-cache}"
: "${MACHINE_LEARNING_UV_EXTRA:=cpu}"
: "${MACHINE_LEARNING_UV_SYNC:=1}"

export MACHINE_LEARNING_CACHE_FOLDER

if [ "$MACHINE_LEARNING_UV_SYNC" != "0" ]; then
  uv sync --extra "$MACHINE_LEARNING_UV_EXTRA"
fi

exec uv run python -m alloy_ml
