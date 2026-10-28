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
  effectivePublicServerUrl =
    if hasEnv "PUBLIC_SERVER_URL" then
      cfg.environment.PUBLIC_SERVER_URL
    else
      cfg.publicServerUrl;
  hasHttpsPublicServerUrl =
    effectivePublicServerUrl != null
    && lib.hasPrefix "https://" (lib.toLower effectivePublicServerUrl);
  publicServerUrlForService =
    if effectivePublicServerUrl == null then "" else effectivePublicServerUrl;
  # Set at exec, after systemd applies environment and environmentFile, so
  # neither can lower production mode or replace the asserted HTTPS origin.
  serverStart = pkgs.writeShellScript "alloy-server-start" ''
    exec ${pkgs.coreutils}/bin/env \
      NODE_ENV=production \
      PUBLIC_SERVER_URL=${lib.escapeShellArg publicServerUrlForService} \
      ${lib.getExe cfg.package}
  '';
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
    (lib.mkRemovedOptionModule [ "services" "alloy-server" "storage" "driver" ] ''
      Only filesystem storage is supported, so the storage backend selector has
      been removed. Configure filesystem storage through
      services.alloy-server.storage.fs.
    '')
    (lib.mkRemovedOptionModule [ "services" "alloy-server" "integrations" "steamgriddb" "apiKeyFile" ] ''
      Put ALLOY_STEAMGRIDDB_API_KEY in services.alloy-server.environmentFile,
      or set ALLOY_STEAMGRIDDB_API_KEY through services.alloy-server.environment.
    '')
    (lib.mkRemovedOptionModule [ "services" "alloy-server" "oauth" "socialAccountProvidersFile" ] ''
      Alloy now has one OpenID Connect provider. Configure it with
      services.alloy-server.auth.oidc and put ALLOY_OIDC_CLIENT_SECRET in
      services.alloy-server.environmentFile.
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
      description = "Externally reachable HTTPS Alloy origin. Required in production.";
    };

    trustedOrigins = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      example = [ "https://alloy.example.com" ];
      description = "Additional trusted browser origins for Alloy requests.";
    };

    trustedProxies = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [
        "127.0.0.1"
        "::1"
      ];
      example = [ "10.0.0.0/8" ];
      description = ''
        IP addresses or CIDR ranges of reverse proxies allowed to report the
        client address through X-Forwarded-For. Rate limits and session IPs
        use the right-most address not listed here; requests from other peers
        are keyed on their socket address. The default trusts a TLS-terminating
        proxy on the same host. Add the proxy's address when it runs elsewhere,
        or set this to [ ] when clients connect to Alloy directly.
      '';
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
        ALLOY_UPLOAD_HMAC_SECRET, ALLOY_STEAMGRIDDB_API_KEY, DATABASE_URL,
        PGPASSWORD, and ALLOY_OIDC_CLIENT_SECRET. The file is read by systemd
        at service start and is not copied into the Nix store.
      '';
    };

    # These options set defaults. An admin can change each setting in the
    # admin UI, and a value saved there wins until the admin resets it. Null
    # leaves the server's built-in default.
    auth = {
      openRegistrations = lib.mkOption {
        type = lib.types.nullOr lib.types.bool;
        default = null;
        description = ''
          Allow anyone to sign up with a passkey. Single sign-on decides
          sign-up for itself. Null uses the server default (false).
        '';
      };

      passkeyEnabled = lib.mkOption {
        type = lib.types.nullOr lib.types.bool;
        default = null;
        description = ''
          Enable passkey sign-in and account bootstrap. Null uses the server
          default (true).
        '';
      };

      requireAuthToBrowse = lib.mkOption {
        type = lib.types.nullOr lib.types.bool;
        default = null;
        description = ''
          Require sign-in before browsing clips, games, and profiles. Null
          uses the server default (true).
        '';
      };

      oidc = {
        enable = lib.mkOption {
          type = lib.types.nullOr lib.types.bool;
          default = null;
          description = ''
            Show the single sign-on button. It only works once the provider
            has a client ID, an issuer URL, and ALLOY_OIDC_CLIENT_SECRET in
            services.alloy-server.environmentFile. Null uses the server
            default (false).
          '';
        };

        displayName = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          default = null;
          example = "Pocket ID";
          description = "Provider name on the sign-in button. Null uses the server default (SSO).";
        };

        issuerUrl = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          default = null;
          example = "https://auth.example.com";
          description = "The provider's issuer URL or the full URL of its discovery document.";
        };

        clientId = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          default = null;
          description = "OAuth client ID registered with the provider.";
        };

        scopes = lib.mkOption {
          type = lib.types.nullOr (lib.types.listOf lib.types.str);
          default = null;
          example = [
            "openid"
            "profile"
            "email"
          ];
          description = "Scopes to request. Null uses the server default (openid profile).";
        };

        allowSignUp = lib.mkOption {
          type = lib.types.nullOr lib.types.bool;
          default = null;
          description = ''
            Create an account the first time someone signs in through the
            provider. Null uses the server default (false).
          '';
        };
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
        type = lib.types.nullOr (lib.types.ints.between 60 86400);
        default = null;
        example = 3600;
        description = "Upload ticket lifetime in seconds, from 60 to 86400. Null uses the server default (900).";
      };
    };

    storage = {
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
      enable = lib.mkEnableOption "a local PostgreSQL server for Alloy" // {
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
          Set database.enable = false when using a remote or independently
          managed PostgreSQL server.
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
        assertion = effectivePublicServerUrl != null;
        message = "Set services.alloy-server.publicServerUrl or services.alloy-server.environment.PUBLIC_SERVER_URL for production deployments.";
      }
      {
        assertion = hasHttpsPublicServerUrl;
        message = "The effective services.alloy-server PUBLIC_SERVER_URL must use https:// in production.";
      }
      {
        assertion = !hasEnv "NODE_ENV" || cfg.environment.NODE_ENV == "production";
        message = "services.alloy-server.environment.NODE_ENV must be production.";
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
          cfg.environmentFile != null
          || hasEnv "ALLOY_STEAMGRIDDB_API_KEY";
        message = "Set ALLOY_STEAMGRIDDB_API_KEY through services.alloy-server.environmentFile or services.alloy-server.environment.";
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
          DATABASE_URL = databaseUrl;
          PORT = toString cfg.port;
          TRUSTED_ORIGINS = lib.concatStringsSep "," ([ publicServerUrlForService ] ++ cfg.trustedOrigins);
          ALLOY_TRUSTED_PROXIES = lib.concatStringsSep "," cfg.trustedProxies;
          ALLOY_STORAGE_FS_CLIPS_PATH = toString cfg.storage.fs.clipsPath;
          ALLOY_STORAGE_FS_THUMBNAILS_PATH = toString cfg.storage.fs.thumbnailsPath;
          ALLOY_STORAGE_FS_ASSETS_PATH = toString cfg.storage.fs.assetsPath;
          PGHOST = cfg.database.host;
          PGUSER = cfg.database.user;
          PGDATABASE = cfg.database.name;
        }
        // lib.optionalAttrs (cfg.auth.openRegistrations != null) {
          ALLOY_OPEN_REGISTRATIONS = lib.boolToString cfg.auth.openRegistrations;
        }
        // lib.optionalAttrs (cfg.auth.passkeyEnabled != null) {
          ALLOY_PASSKEY_ENABLED = lib.boolToString cfg.auth.passkeyEnabled;
        }
        // lib.optionalAttrs (cfg.auth.requireAuthToBrowse != null) {
          ALLOY_REQUIRE_AUTH_TO_BROWSE = lib.boolToString cfg.auth.requireAuthToBrowse;
        }
        // lib.optionalAttrs (cfg.auth.oidc.enable != null) {
          ALLOY_OIDC_ENABLED = lib.boolToString cfg.auth.oidc.enable;
        }
        // lib.optionalAttrs (cfg.auth.oidc.displayName != null) {
          ALLOY_OIDC_DISPLAY_NAME = cfg.auth.oidc.displayName;
        }
        // lib.optionalAttrs (cfg.auth.oidc.issuerUrl != null) {
          ALLOY_OIDC_ISSUER_URL = cfg.auth.oidc.issuerUrl;
        }
        // lib.optionalAttrs (cfg.auth.oidc.clientId != null) {
          ALLOY_OIDC_CLIENT_ID = cfg.auth.oidc.clientId;
        }
        // lib.optionalAttrs (cfg.auth.oidc.scopes != null) {
          ALLOY_OIDC_SCOPES = lib.concatStringsSep " " cfg.auth.oidc.scopes;
        }
        // lib.optionalAttrs (cfg.auth.oidc.allowSignUp != null) {
          ALLOY_OIDC_ALLOW_SIGN_UP = lib.boolToString cfg.auth.oidc.allowSignUp;
        }
        // lib.optionalAttrs (cfg.limits.defaultStorageQuotaBytes != null) {
          ALLOY_DEFAULT_STORAGE_QUOTA_BYTES = toString cfg.limits.defaultStorageQuotaBytes;
        }
        // lib.optionalAttrs (cfg.limits.uploadTtlSec != null) {
          ALLOY_UPLOAD_TTL_SEC = toString cfg.limits.uploadTtlSec;
        }
        // lib.optionalAttrs (!isDatabaseUnixSocket) {
          PGPORT = toString cfg.database.port;
        }
        // cfg.environment;

      serviceConfig =
        {
          ExecStart = serverStart;
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
