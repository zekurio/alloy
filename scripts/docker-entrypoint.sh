#!/bin/sh
set -eu

: "${ALLOY_STORAGE_DRIVER:=fs}"
: "${ALLOY_STORAGE_FS_CLIPS_PATH:=/data/storage/clips}"
: "${ALLOY_STORAGE_FS_USERS_PATH:=/data/storage/users}"
export ALLOY_STORAGE_DRIVER
export ALLOY_STORAGE_FS_CLIPS_PATH
export ALLOY_STORAGE_FS_USERS_PATH

mkdir -p "$ALLOY_STORAGE_FS_CLIPS_PATH" "$ALLOY_STORAGE_FS_USERS_PATH"

if [ "$(id -u)" = "0" ]; then
  chown -R 1993:1993 /data "$ALLOY_STORAGE_FS_CLIPS_PATH" "$ALLOY_STORAGE_FS_USERS_PATH"
  exec setpriv --reuid=1993 --regid=1993 --clear-groups "$@"
fi

exec "$@"
