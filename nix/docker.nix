{
  lib,
  dockerTools,
  writeShellApplication,
  coreutils,
  util-linux,
  cacert,
  tzdata,
  alloy,
  version ? alloy.version,
}:

let
  uid = 1993;
  gid = 1993;

  # Ensure the mutable dirs exist, and when started as root, fix volume
  # ownership and drop to the unprivileged alloy user. The app itself creates
  # any nested dirs recursively at runtime.
  entrypoint = writeShellApplication {
    name = "alloy-entrypoint";
    runtimeInputs = [
      coreutils
      util-linux
      alloy
    ];
    text = ''
      : "''${ALLOY_STORAGE_DRIVER:=fs}"
      : "''${ALLOY_STORAGE_FS_CLIPS_PATH:=/data/storage/clips}"
      : "''${ALLOY_STORAGE_FS_USERS_PATH:=/data/storage/users}"
      export ALLOY_STORAGE_DRIVER
      export ALLOY_STORAGE_FS_CLIPS_PATH
      export ALLOY_STORAGE_FS_USERS_PATH

      mkdir -p /data/storage/clips /data/storage/users

      if [ "$(id -u)" = "0" ]; then
        chown -R ${toString uid}:${toString gid} /data
        exec setpriv --reuid=${toString uid} --regid=${toString gid} \
          --clear-groups alloy
      fi

      exec alloy
    '';
  };
in
dockerTools.streamLayeredImage {
  name = "alloy";
  tag = "latest";

  contents = [
    alloy
    entrypoint
    cacert
    tzdata
  ];

  # Create the runtime user and base dirs. Bind/volume mounts at these paths
  # are re-owned by the entrypoint on startup when running as root.
  enableFakechroot = true;
  fakeRootCommands = ''
    ${dockerTools.shadowSetup}
    groupadd --system --gid ${toString gid} alloy
    useradd --system --uid ${toString uid} --gid ${toString gid} \
      --home-dir /app --shell /sbin/nologin alloy
    mkdir -p /app /data/storage/clips /data/storage/users /tmp
    chmod 1777 /tmp
    chown -R ${toString uid}:${toString gid} /app /data
  '';

  config = {
    Entrypoint = [ "/bin/alloy-entrypoint" ];
    # WEB_DIST_DIR/ALLOY_MIGRATIONS_DIR/NODE_ENV are baked into the alloy
    # wrapper; only declare the deployment-facing vars.
    Env = [
      "PORT=2552"
      "APP_VERSION=${version}"
      "ALLOY_STORAGE_DRIVER=fs"
      "ALLOY_STORAGE_FS_CLIPS_PATH=/data/storage/clips"
      "ALLOY_STORAGE_FS_USERS_PATH=/data/storage/users"
      "SSL_CERT_FILE=${cacert}/etc/ssl/certs/ca-bundle.crt"
    ];
    ExposedPorts = {
      "2552/tcp" = { };
    };
    WorkingDir = "/app";
    Labels = {
      "org.opencontainers.image.title" = "alloy";
      "org.opencontainers.image.description" = "Open-source and self-hostable alternative to Medal.tv";
      "org.opencontainers.image.source" = "https://github.com/zekurio/alloy";
      "org.opencontainers.image.licenses" = "AGPL-3.0-only";
      "org.opencontainers.image.version" = version;
    };
  };
}
