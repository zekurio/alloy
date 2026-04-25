#!/usr/bin/env sh
set -eu

restore_chown() {
  for tool in chown dpkg-statoverride install su; do
    real_tool="/usr/bin/${tool}.alloy-real"
    if [ -e "${real_tool}" ]; then
      mv "${real_tool}" "/usr/bin/${tool}"
    fi
  done
}
trap restore_chown EXIT

replace_rootless_tool() {
  tool="$1"
  tool_path="$(command -v "$tool")"
  real_tool_path="${tool_path}.alloy-real"
  mv "${tool_path}" "${real_tool_path}"
  printf '#!/usr/bin/env sh\nexit 0\n' >"${tool_path}"
  chmod +x "${tool_path}"
}

replace_rootless_install() {
  tool_path="$(command -v install)"
  real_tool_path="${tool_path}.alloy-real"
  mv "${tool_path}" "${real_tool_path}"
  cat >"${tool_path}" <<'EOF'
#!/usr/bin/env sh
real_install="/usr/bin/install.alloy-real"
set -- "$@"
filtered_args=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o|-g|--owner|--group)
      shift 2
      ;;
    --owner=*|--group=*)
      shift
      ;;
    *)
      filtered_args="${filtered_args} $(printf '%s' "$1" | sed "s/'/'\\\\''/g; s/^/'/; s/$/'/")"
      shift
      ;;
  esac
done
eval "set -- ${filtered_args}"
exec "${real_install}" "$@"
EOF
  chmod +x "${tool_path}"
}

if ! chown root:adm /tmp >/dev/null 2>&1; then
  replace_rootless_tool chown
  replace_rootless_tool dpkg-statoverride
  replace_rootless_install
  replace_rootless_tool su
fi

printf 'APT::Sandbox::User "root";\n' >/etc/apt/apt.conf.d/99alloy-rootless-build

apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  gnupg \
  libva-drm2 \
  libva2 \
  mesa-va-drivers \
  mesa-vulkan-drivers \
  vainfo \
  "$@"

mkdir -p /etc/apt/keyrings
curl -fsSL https://repo.jellyfin.org/jellyfin_team.gpg.key \
  | gpg --dearmor -o /etc/apt/keyrings/jellyfin.gpg

architecture="$(dpkg --print-architecture)"
cat >/etc/apt/sources.list.d/jellyfin.sources <<EOF
Types: deb
URIs: https://repo.jellyfin.org/debian
Suites: bookworm
Components: main
Architectures: ${architecture}
Signed-By: /etc/apt/keyrings/jellyfin.gpg
EOF

apt-get update
apt-get install -y --no-install-recommends jellyfin-ffmpeg7

optional_packages=""
for package in \
  i965-va-driver \
  intel-media-va-driver \
  libmfx1 \
  libvpl2
do
  if apt-cache show "$package" >/dev/null 2>&1; then
    optional_packages="$optional_packages $package"
  fi
done

if [ -n "$optional_packages" ]; then
  # shellcheck disable=SC2086
  apt-get install -y --no-install-recommends $optional_packages
fi

rm -rf /var/lib/apt/lists/*
