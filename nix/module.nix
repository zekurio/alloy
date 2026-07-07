{ self }:

{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.alloy-server;

  packageForSystem =
    self.packages.${pkgs.stdenv.hostPlatform.system}.default
      or (throw "alloy only packages x86_64-linux for now");

  systemdDirectoryName =
    root: path:
    let
      pathString = toString path;
      prefix = "${root}/";
    in
    if lib.hasPrefix prefix pathString then
      lib.removePrefix prefix pathString
    else
      null;
  managedStateDirectory = systemdDirectoryName "/var/lib" cfg.stateDir;
  pathIsUnder =
    parent: child:
    let
      parentString = toString parent;
      childString = toString child;
    in
    childString == parentString || lib.hasPrefix "${parentString}/" childString;
  fsStoragePaths = [
    cfg.storage.fs.clipsPath
    cfg.storage.fs.thumbnailsPath
    cfg.storage.fs.assetsPath
  ];
  serverExternalWritePaths = lib.unique (
    lib.optionals (managedStateDirectory == null) [ cfg.stateDir ]
    ++ lib.filter (path: !(pathIsUnder cfg.stateDir path)) fsStoragePaths
  );
  isDatabaseUnixSocket = lib.hasPrefix "/" cfg.database.host;
  databaseConnectHost =
    if lib.hasPrefix "[" cfg.database.host then
      cfg.database.host
    else if lib.hasInfix ":" cfg.database.host then
      "[${cfg.database.host}]"
    else
      cfg.database.host;
  databaseUrl =
    if isDatabaseUnixSocket then
      "postgresql://${cfg.database.user}@localhost/${cfg.database.name}?host=${cfg.database.host}"
    else
      "postgresql://${cfg.database.user}@${databaseConnectHost}:${toString cfg.database.port}/${cfg.database.name}";
  hasEnv = name: builtins.hasAttr name cfg.environment;
  hasAccelerationDevices = cfg.accelerationDevices != [ ];
in
{
  imports = [
    (lib.mkRenamedOptionModule
      [ "services" "alloy-clips" ]
      [ "services" "alloy-server" ]
    )
    (lib.mkRenamedOptionModule
      [ "services" "alloy-server" "database" "createLocally" ]
      [ "services" "alloy-server" "database" "enable" ]
    )
    (lib.mkRenamedOptionModule
      [ "services" "alloy-server" "clipsStorageDir" ]
      [ "services" "alloy-server" "storage" "fs" "clipsPath" ]
    )
    (lib.mkRenamedOptionModule
      [ "services" "alloy-server" "userAssetsStorageDir" ]
      [ "services" "alloy-server" "storage" "fs" "assetsPath" ]
    )
    (lib.mkRenamedOptionModule
      [ "services" "alloy-server" "storage" "fs" "usersPath" ]
      [ "services" "alloy-server" "storage" "fs" "assetsPath" ]
    )
    (lib.mkRemovedOptionModule [ "services" "alloy-server" "storageDir" ] ''
      Configure services.alloy-server.storage.fs.clipsPath and
      services.alloy-server.storage.fs.thumbnailsPath and
      services.alloy-server.storage.fs.assetsPath directly.
    '')
    (lib.mkRemovedOptionModule [ "services" "alloy-server" "configFile" ] ''
      Alloy no longer reads mutable config.json. Use typed NixOS options under
      services.alloy-server or services.alloy-server.environment.
    '')
    (lib.mkRemovedOptionModule [ "services" "alloy-server" "initialRuntimeConfig" ] ''
      Alloy no longer bootstraps mutable runtime config. Use typed NixOS
      options under services.alloy-server or services.alloy-server.environment.
    '')
    (lib.mkRemovedOptionModule [ "services" "alloy-server" "database" "url" ] ''
      Configure services.alloy-server.database.host, port, name, and user instead.
      The module derives DATABASE_URL like the Immich module. For unusual
      setups, override DATABASE_URL through services.alloy-server.environment or
      a systemd service override.
    '')
    (lib.mkRemovedOptionModule [ "services" "alloy-server" "database" "urlFile" ] ''
      Configure services.alloy-server.database.host, port, name, and user instead.
      If you need secret database credentials, provide PGPASSWORD or DATABASE_URL
      through services.alloy-server.environmentFile.
    '')
    (lib.mkRemovedOptionModule [ "services" "alloy-server" "database" "socketDir" ] ''
      Use services.alloy-server.database.host for both PostgreSQL hostnames and
      Unix socket directories.
    '')
    (lib.mkRemovedOptionModule [ "services" "alloy-server" "secrets" "viewerCookieSecretFile" ] ''
      Put ALLOY_VIEWER_COOKIE_SECRET in services.alloy-server.environmentFile,
      or set ALLOY_VIEWER_COOKIE_SECRET through services.alloy-server.environment.
    '')
    (lib.mkRemovedOptionModule [ "services" "alloy-server" "secrets" "uploadHmacSecretFile" ] ''
      Put ALLOY_UPLOAD_HMAC_SECRET in services.alloy-server.environmentFile,
      or set ALLOY_UPLOAD_HMAC_SECRET through services.alloy-server.environment.
    '')
    (lib.mkRemovedOptionModule [ "services" "alloy-server" "storage" "s3" ] ''
      S3-compatible storage support has been removed. Configure filesystem
      storage through services.alloy-server.storage.fs.
    '')
    (lib.mkRemovedOptionModule [ "services" "alloy-server" "integrations" "steamgriddb" "apiKeyFile" ] ''
      Put ALLOY_STEAMGRIDDB_API_KEY in services.alloy-server.environmentFile,
      or set ALLOY_STEAMGRIDDB_API_KEY through services.alloy-server.environment.
    '')
    (lib.mkRemovedOptionModule [ "services" "alloy-server" "oauth" "socialAccountProvidersFile" ] ''
      Put ALLOY_SOCIALACCOUNT_PROVIDERS in services.alloy-server.environmentFile,
      or set ALLOY_SOCIALACCOUNT_PROVIDERS through services.alloy-server.environment.
    '')
    (lib.mkRemovedOptionModule [ "services" "alloy-server" "cacheDir" ] ''
      Alloy now keeps temporary media work/cache files in the OS temp area.
      Configure durable storage through services.alloy-server.storage.
    '')
  ]
  ++ map
    (
      option:
      lib.mkRemovedOptionModule [ "services" "alloy-server" "machine-learning" option ] ''
        Alloy no longer ships a machine learning inference service. Game
        tagging is fully deterministic (recorder detection + SteamGridDB).
      ''
    )
    [
      "enable"
      "package"
      "host"
      "port"
      "baseUrl"
      "cacheDir"
      "environment"
    ];

  options.services.alloy-server = {
    enable = lib.mkEnableOption "Alloy";

    package = lib.mkOption {
      type = lib.types.package;
      default = packageForSystem.override { ffmpegPackage = cfg.ffmpegPackage; };
      defaultText = lib.literalExpression ''inputs.alloy.packages.''${pkgs.stdenv.hostPlatform.system}.default.override { ffmpegPackage = config.services.alloy-server.ffmpegPackage; }'';
      description = "Alloy package to run.";
    };

    ffmpegPackage = lib.mkOption {
      type = lib.types.package;
      default = pkgs.ffmpeg-headless;
      defaultText = lib.literalExpression "pkgs.ffmpeg-headless";
      example = lib.literalExpression "pkgs.jellyfin-ffmpeg";
      description = ''
        ffmpeg package placed on Alloy's PATH. Use pkgs.jellyfin-ffmpeg for
        hardware acceleration support (NVENC, Intel Quick Sync, VA-API); the
        default ffmpeg-headless only carries software encoders. Hardware
        encoding additionally requires services.alloy-server.accelerationDevices
        and the matching host drivers (see that option's description).
      '';
    };

    accelerationDevices = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      example = [ "/dev/dri/renderD128" ];
      description = ''
        Device nodes the transcoder may use for hardware-accelerated encoding,
        e.g. the DRI render node for VA-API and Intel Quick Sync. When
        non-empty, the service loses PrivateDevices isolation, is restricted
        to exactly these devices via DeviceAllow, and joins the video/render
        groups.

        For Intel Quick Sync (QSV) the host also needs the runtime drivers:

          hardware.graphics = {
            enable = true;
            extraPackages = with pkgs; [
              intel-media-driver # iHD VA-API driver
              vpl-gpu-rt # oneVPL runtime for QSV (12th gen+)
            ];
          };

        Combine with services.alloy-server.ffmpegPackage =
        pkgs.jellyfin-ffmpeg, which is built with QSV (libvpl) and VA-API
        support.
      '';
    };

    user = lib.mkOption {
      type = lib.types.str;
      default = "alloy";
      description = "User account the Alloy service runs as.";
    };

    group = lib.mkOption {
      type = lib.types.str;
      default = "alloy";
      description = "Group account the Alloy service runs as.";
    };

    extraGroups = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      description = "Extra groups for the Alloy service user.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 2552;
      description = "TCP port Alloy listens on.";
    };

    publicServerUrl = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "https://alloy.example.com";
      description = "Externally reachable Alloy origin. Required in production.";
    };

    trustedOrigins = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      example = [ "https://alloy.example.com" ];
      description = "Additional trusted browser origins for Alloy requests.";
    };

    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Open the Alloy port in the NixOS firewall.";
    };

    stateDir = lib.mkOption {
      type = lib.types.path;
      default = "/var/lib/alloy";
      description = ''
        Mutable Alloy state directory. Paths below /var/lib are managed with
        systemd StateDirectory. Other paths must be created by the operator.
      '';
    };

    environment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      example = { ALLOY_STORAGE_FS_CLIPS_PATH = "/srv/alloy/clips"; };
      description = "Additional environment variables for Alloy. Values here override typed module defaults.";
    };

    environmentFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      example = "/run/secrets/alloy.env";
      description = ''
        Optional systemd environment file containing secret Alloy environment
        variables such as ALLOY_VIEWER_COOKIE_SECRET,
        ALLOY_UPLOAD_HMAC_SECRET, DATABASE_URL, PGPASSWORD, and
        OAuth provider JSON. The file is read by systemd at service start and is
        not copied into the Nix store.
      '';
    };

    auth = {
      openRegistrations = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Allow sign-up through enabled registration methods.";
      };

      passkeyEnabled = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Enable passkey sign-in and account bootstrap.";
      };

      requireAuthToBrowse = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Require sign-in before browsing clips, games, and profiles.";
      };
    };

    limits = {
      defaultStorageQuotaBytes = lib.mkOption {
        type = lib.types.nullOr lib.types.ints.positive;
        default = null;
        example = 107374182400;
        description = "Default per-user storage quota in bytes. Null means unlimited.";
      };

      uploadTtlSec = lib.mkOption {
        type = lib.types.ints.positive;
        default = 900;
        description = "Upload ticket lifetime in seconds.";
      };
    };

    storage = {
      driver = lib.mkOption {
        type = lib.types.enum [
          "fs"
        ];
        default = "fs";
        description = "Storage backend for clips, thumbnails, and other assets. Only filesystem storage is supported.";
      };

      fs = {
        clipsPath = lib.mkOption {
          type = lib.types.path;
          default = "${cfg.stateDir}/storage/clips";
          defaultText = lib.literalExpression ''"\${config.services.alloy-server.stateDir}/storage/clips"'';
          description = "Filesystem root for clip sources and derived clip media.";
        };

        thumbnailsPath = lib.mkOption {
          type = lib.types.path;
          default = "${cfg.stateDir}/storage/thumbnails";
          defaultText = lib.literalExpression ''"\${config.services.alloy-server.stateDir}/storage/thumbnails"'';
          description = "Filesystem root for clip thumbnails.";
        };

        assetsPath = lib.mkOption {
          type = lib.types.path;
          default = "${cfg.stateDir}/storage/assets";
          defaultText = lib.literalExpression ''"\${config.services.alloy-server.stateDir}/storage/assets"'';
          description = "Filesystem root for misc assets: user avatars/banners and admin-authored game assets.";
        };
      };

    };

    database = {
      enable = lib.mkEnableOption "the PostgreSQL database for use with Alloy" // {
        default = true;
      };

      createDB = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Whether to automatically create the Alloy PostgreSQL database and role.";
      };

      name = lib.mkOption {
        type = lib.types.str;
        default = "alloy";
        description = "PostgreSQL database name.";
      };

      user = lib.mkOption {
        type = lib.types.str;
        default = "alloy";
        description = "PostgreSQL role name.";
      };

      host = lib.mkOption {
        type = lib.types.str;
        default = "/run/postgresql";
        example = "127.0.0.1";
        description = ''
          Hostname or address of the PostgreSQL server. If this is an absolute
          path, it is treated as a Unix socket directory.
        '';
      };

      port = lib.mkOption {
        type = lib.types.port;
        default = 5432;
        description = "Port of the PostgreSQL server.";
      };
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = pkgs.stdenv.hostPlatform.system == "x86_64-linux";
        message = "services.alloy-server currently supports x86_64-linux only.";
      }
      {
        assertion = cfg.publicServerUrl != null;
        message = "services.alloy-server.publicServerUrl must be set for production deployments.";
      }
      {
        assertion =
          cfg.environmentFile != null
          || hasEnv "ALLOY_VIEWER_COOKIE_SECRET";
        message = "Set ALLOY_VIEWER_COOKIE_SECRET through services.alloy-server.environmentFile or services.alloy-server.environment.";
      }
      {
        assertion =
          cfg.environmentFile != null
          || hasEnv "ALLOY_UPLOAD_HMAC_SECRET";
        message = "Set ALLOY_UPLOAD_HMAC_SECRET through services.alloy-server.environmentFile or services.alloy-server.environment.";
      }
      {
        assertion =
          !(cfg.database.enable && cfg.database.createDB && isDatabaseUnixSocket)
          || cfg.user == cfg.database.user;
        message = "services.alloy-server.user must match services.alloy-server.database.user when creating a peer-authenticated local PostgreSQL database.";
      }
    ];

    users.groups.${cfg.group} = { };
    users.users.${cfg.user} = {
      isSystemUser = true;
      group = cfg.group;
      extraGroups = cfg.extraGroups;
      home = cfg.stateDir;
    };

    services.postgresql = lib.mkIf cfg.database.enable {
      enable = true;
      settings = lib.mkIf isDatabaseUnixSocket {
        unix_socket_directories = cfg.database.host;
      };
      ensureDatabases = lib.mkIf cfg.database.createDB [ cfg.database.name ];
      ensureUsers = lib.mkIf cfg.database.createDB [
        {
          name = cfg.database.user;
          ensureDBOwnership = true;
          ensureClauses.login = true;
        }
      ];
    };

    networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [ cfg.port ];

    systemd.tmpfiles.rules = map (path: "e ${path} 0750 ${cfg.user} ${cfg.group} - -") (
      lib.filter (path: !(pathIsUnder cfg.stateDir path)) fsStoragePaths
    );

    systemd.services.alloy-server = {
      description = "Alloy server";
      wantedBy = [ "multi-user.target" ];
      requires = lib.optional cfg.database.enable "postgresql.target";
      wants = [ "network-online.target" ] ++ lib.optional cfg.database.enable "postgresql.target";
      after = [ "network-online.target" ] ++ lib.optional cfg.database.enable "postgresql.target";

      environment =
        {
          NODE_ENV = "production";
          DATABASE_URL = databaseUrl;
          PORT = toString cfg.port;
          PUBLIC_SERVER_URL = cfg.publicServerUrl;
          TRUSTED_ORIGINS = lib.concatStringsSep "," ([ cfg.publicServerUrl ] ++ cfg.trustedOrigins);
          ALLOY_OPEN_REGISTRATIONS = lib.boolToString cfg.auth.openRegistrations;
          ALLOY_PASSKEY_ENABLED = lib.boolToString cfg.auth.passkeyEnabled;
          ALLOY_REQUIRE_AUTH_TO_BROWSE = lib.boolToString cfg.auth.requireAuthToBrowse;
          ALLOY_UPLOAD_TTL_SEC = toString cfg.limits.uploadTtlSec;
          ALLOY_STORAGE_DRIVER = cfg.storage.driver;
          ALLOY_STORAGE_FS_CLIPS_PATH = toString cfg.storage.fs.clipsPath;
          ALLOY_STORAGE_FS_THUMBNAILS_PATH = toString cfg.storage.fs.thumbnailsPath;
          ALLOY_STORAGE_FS_ASSETS_PATH = toString cfg.storage.fs.assetsPath;
          PGHOST = cfg.database.host;
          PGUSER = cfg.database.user;
          PGDATABASE = cfg.database.name;
        }
        // lib.optionalAttrs (cfg.limits.defaultStorageQuotaBytes != null) {
          ALLOY_DEFAULT_STORAGE_QUOTA_BYTES = toString cfg.limits.defaultStorageQuotaBytes;
        }
        // lib.optionalAttrs (!isDatabaseUnixSocket) {
          PGPORT = toString cfg.database.port;
        }
        // cfg.environment;

      serviceConfig =
        {
          ExecStart = lib.getExe cfg.package;
          User = cfg.user;
          Group = cfg.group;
          WorkingDirectory = cfg.stateDir;
          Restart = "on-failure";
          RestartSec = 5;
          UMask = "0077";

          NoNewPrivileges = true;
          # Hardware transcoding needs the real /dev for the allowed render
          # nodes; without acceleration devices, keep /dev fully private.
          PrivateDevices = !hasAccelerationDevices;
          PrivateTmp = true;
          ProtectSystem = "strict";
          ProtectHome = true;
          StateDirectory = lib.mkIf (managedStateDirectory != null) managedStateDirectory;
          ReadWritePaths = serverExternalWritePaths;
        }
        // lib.optionalAttrs hasAccelerationDevices {
          DevicePolicy = "closed";
          DeviceAllow = map (device: "${device} rw") cfg.accelerationDevices;
          SupplementaryGroups = [
            "video"
            "render"
          ];
        }
        // lib.optionalAttrs (cfg.environmentFile != null) {
          EnvironmentFile = cfg.environmentFile;
        }
        // lib.optionalAttrs (managedStateDirectory != null) {
          StateDirectoryMode = "0750";
        };
    };
  };
}
