#!/usr/bin/env bash
# Creates the repo `.env` from `.env.example` on first shell entry. Runs from
# the shell hook in dev-shell.nix.
set -eu

template="$DEVSHELL_ROOT/.env.example"
env_file="$DEVSHELL_ROOT/.env"

if [ ! -e "$env_file" ]; then
  # Owner-only: the file is where local API keys and secrets get added.
  umask 077
  cp "$template" "$env_file.tmp"
  mv "$env_file.tmp" "$env_file"
  echo "Created .env from .env.example" >&2
fi
