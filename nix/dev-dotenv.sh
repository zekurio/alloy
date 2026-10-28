#!/usr/bin/env bash
# Creates the repo `.env` from `.env.example` with generated local secrets on
# first shell entry. Runs from enterShell in devenv.nix.
set -eu

template="$DEVENV_ROOT/.env.example"
env_file="$DEVENV_ROOT/.env"

# Hex keeps the value free of characters that are special to sed or dotenv.
secret() {
  openssl rand -hex 32
}

if [ ! -e "$env_file" ]; then
  umask 077
  sed \
    -e "s/^ALLOY_VIEWER_COOKIE_SECRET=.*/ALLOY_VIEWER_COOKIE_SECRET=$(secret)/" \
    -e "s/^ALLOY_UPLOAD_HMAC_SECRET=.*/ALLOY_UPLOAD_HMAC_SECRET=$(secret)/" \
    "$template" >"$env_file.tmp"
  mv "$env_file.tmp" "$env_file"
  echo "Created .env from .env.example with generated local secrets" >&2
fi
