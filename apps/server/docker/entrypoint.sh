#!/bin/sh
set -eu

: "${ALLOY_CONFIG_FILE:=/config/runtime-config.json}"
: "${ENCODE_SCRATCH_DIR:=/cache/encode}"

CONFIG_DIR="$(dirname "$ALLOY_CONFIG_FILE")"

mkdir -p "$CONFIG_DIR" "$ENCODE_SCRATCH_DIR"

if [ "$(id -u)" = "0" ]; then
  chown -R deno:deno "$CONFIG_DIR"
  chown deno:deno "$ENCODE_SCRATCH_DIR"

  exec su deno -s /bin/sh -c 'exec alloy'
fi

exec alloy
