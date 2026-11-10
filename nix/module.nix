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
      example = {
        ALLOY_DEFAULT_STORAGE_QUOTA_BYTES = "107374182400";
      };
      description = ''
        Additional environment variables for Alloy; see `.env.example` for
        the full list. Values here override the ones this module sets. The
        `ALLOY_*` admin settings (sign-in, limits, transcoding, appearance)
        are defaults: an admin can change each one in the admin UI, and a
        value saved there wins until the admin resets it.
      '';
    };

    environmentFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      example = "/run/secrets/alloy.env";
      description = ''
        Optional systemd environment file containing secret Alloy environment
        variables such as ALLOY_STEAMGRIDDB_API_KEY, DATABASE_URL,
        PGPASSWORD, ALLOY_OIDC_CLIENT_SECRET, and ALLOY_SETUP_TOKEN. The file is read by systemd
        at service start and is not copied into the Nix store.
      '';
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
