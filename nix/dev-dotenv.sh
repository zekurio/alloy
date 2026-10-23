#!/usr/bin/env bash
# Creates the repo `.env` with generated local secrets on first shell entry,
# and adds secrets an older `.env` lacks unless the shell already sets them.
# Runs from enterShell in devenv.nix.
set -eu

env_file="$DEVENV_ROOT/.env"

secret() {
  openssl rand -base64 48 | tr -d '\n'
}

if [ ! -e "$env_file" ]; then
  viewer_cookie_secret="$(secret)"
  upload_hmac_secret="$(secret)"

  umask 077
  cat >"$env_file" <<EOF
# Local development fallback values. The devenv shell exports DATABASE_URL for
# its managed Postgres and shell variables always win over this file.
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/alloy

PORT=2552
PUBLIC_SERVER_URL=http://localhost:2552
TRUSTED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173

ALLOY_VIEWER_COOKIE_SECRET=$viewer_cookie_secret
ALLOY_UPLOAD_HMAC_SECRET=$upload_hmac_secret

# Required. Create a key at https://www.steamgriddb.com/profile/preferences/api
ALLOY_STEAMGRIDDB_API_KEY=

ALLOY_STORAGE_FS_CLIPS_PATH=../../data/storage/clips
ALLOY_STORAGE_FS_THUMBNAILS_PATH=../../data/storage/thumbnails
ALLOY_STORAGE_FS_ASSETS_PATH=../../data/storage/assets
EOF
  chmod 600 "$env_file"
  echo "Created .env with generated local secrets" >&2
fi

for key in ALLOY_VIEWER_COOKIE_SECRET ALLOY_UPLOAD_HMAC_SECRET; do
  [ -z "${!key:-}" ] || continue
  [ -z "$(sed -n "s/^$key=//p" "$env_file" | tail -n 1)" ] || continue

  value="$(secret)"
  printf '\n%s=%s\n' "$key" "$value" >>"$env_file"
  chmod 600 "$env_file"
  echo "Added $key to .env with a generated local secret" >&2
done
