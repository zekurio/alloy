{ self }:

{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.alloy-clips;
  jsonFormat = pkgs.formats.json { };

  packageForSystem =
    self.packages.${pkgs.stdenv.hostPlatform.system}.default
      or (throw "alloy only packages x86_64-linux for now");

  configDir = dirOf cfg.configFile;
  encodeDir = "${cfg.cacheDir}/encode";
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
  managedCacheDirectory = systemdDirectoryName "/var/cache" cfg.cacheDir;
  pathIsUnder =
    parent: child:
    let
      parentString = toString parent;
      childString = toString child;
    in
    childString == parentString || lib.hasPrefix "${parentString}/" childString;
  serverExternalWritePaths = lib.unique (
    lib.optionals (managedStateDirectory == null) [ cfg.stateDir ]
    ++ lib.optionals (managedCacheDirectory == null) [ cfg.cacheDir ]
    ++ lib.optionals (!(pathIsUnder cfg.stateDir configDir)) [ configDir ]
    ++ lib.optionals (!(pathIsUnder cfg.stateDir cfg.storageDir)) [ cfg.storageDir ]
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
  bootstrapConfig =
    if cfg.initialRuntimeConfig == null then
      null
    else
      jsonFormat.generate "alloy-runtime-config.json" cfg.initialRuntimeConfig;
  preStart = lib.optionalString (bootstrapConfig != null) ''
    if [ ! -e ${lib.escapeShellArg cfg.configFile} ]; then
      install -m 0640 ${lib.escapeShellArg bootstrapConfig} ${lib.escapeShellArg cfg.configFile}
    fi
  '';
in
{
  imports = [
    (lib.mkRenamedOptionModule
      [ "services" "alloy-clips" "database" "createLocally" ]
      [ "services" "alloy-clips" "database" "enable" ]
    )
    (lib.mkRemovedOptionModule [ "services" "alloy-clips" "database" "url" ] ''
      Configure services.alloy-clips.database.host, port, name, and user instead.
      The module now derives DATABASE_URL like the Immich module. For unusual
      setups, override DATABASE_URL through services.alloy-clips.environment or
      a systemd service override.
    '')
    (lib.mkRemovedOptionModule [ "services" "alloy-clips" "database" "urlFile" ] ''
      Configure services.alloy-clips.database.host, port, name, and user instead.
      If you need secret database credentials, provide PGPASSWORD or DATABASE_URL
      with a systemd service override such as EnvironmentFile or LoadCredential.
    '')
    (lib.mkRemovedOptionModule [ "services" "alloy-clips" "database" "socketDir" ] ''
      Use services.alloy-clips.database.host for both PostgreSQL hostnames and
      Unix socket directories.
    '')
  ]
  ++ map
    (
      option:
      lib.mkRemovedOptionModule [ "services" "alloy-clips" "machine-learning" option ] ''
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

  options.services.alloy-clips = {
    enable = lib.mkEnableOption "Alloy";

    package = lib.mkOption {
      type = lib.types.package;
      default = packageForSystem;
      defaultText = lib.literalExpression "inputs.alloy.packages.\${pkgs.stdenv.hostPlatform.system}.default";
      description = "Alloy package to run.";
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
      example = [ "render" ];
      description = "Extra groups for hardware encoder device access.";
    };

    accelerationDevices = lib.mkOption {
      type = lib.types.nullOr (lib.types.listOf lib.types.str);
      default = [ ];
      example = [ "/dev/dri/renderD128" ];
      description = ''
        Device paths that Alloy services can access for hardware acceleration.
        This is useful for hardware encoding.
        The special value `[ ]` disallows device access using PrivateDevices.
        Set to null to allow access to all devices.
      '';
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

    cacheDir = lib.mkOption {
      type = lib.types.path;
      default = "/var/cache/alloy";
      description = ''
        Mutable Alloy cache directory for encoder scratch data. Paths below
        /var/cache are managed with systemd CacheDirectory. Other paths must be
        created by the operator.
      '';
    };

    storageDir = lib.mkOption {
      type = lib.types.path;
      default = "${config.services.alloy-clips.stateDir}/storage";
      defaultText = lib.literalExpression ''"\${config.services.alloy-clips.stateDir}/storage"'';
      description = ''
        Filesystem storage root used when Alloy bootstraps runtime config. If
        this is outside stateDir, create it manually and make it writable by the
        Alloy service user.
      '';
    };

    configFile = lib.mkOption {
      type = lib.types.path;
      default = "${config.services.alloy-clips.stateDir}/config.json";
      defaultText = lib.literalExpression ''"\${config.services.alloy-clips.stateDir}/config.json"'';
      description = ''
        Mutable JSON runtime config file used by Alloy and the admin UI. Alloy
        always reads `config.json` from the data dir (stateDir); keep this in
        sync if you override it.
      '';
    };

    initialRuntimeConfig = lib.mkOption {
      type = lib.types.nullOr jsonFormat.type;
      default = null;
      description = ''
        Optional JSON runtime config copied to configFile only when it does not
        already exist. Leave null to let Alloy generate a config with fresh
        runtime secrets on first boot.
      '';
    };

    environment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      example = {
        AWS_ACCESS_KEY_ID = "alloy";
      };
      description = "Additional environment variables for Alloy.";
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
        message = "services.alloy-clips currently supports x86_64-linux only.";
      }
      {
        assertion = cfg.publicServerUrl != null;
        message = "services.alloy-clips.publicServerUrl must be set for production deployments.";
      }
      {
        assertion =
          !(cfg.database.enable && cfg.database.createDB && isDatabaseUnixSocket)
          || cfg.user == cfg.database.user;
        message = "services.alloy-clips.user must match services.alloy-clips.database.user when creating a peer-authenticated local PostgreSQL database.";
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

    systemd.tmpfiles.rules = lib.optional (!(pathIsUnder cfg.stateDir cfg.storageDir))
      "e ${cfg.storageDir} 0750 ${cfg.user} ${cfg.group} - -";

    systemd.services.alloy-clips = {
      description = "Alloy clip sharing server";
      wantedBy = [ "multi-user.target" ];
      requires = lib.optional cfg.database.enable "postgresql.target";
      wants = [ "network-online.target" ] ++ lib.optional cfg.database.enable "postgresql.target";
      after = [ "network-online.target" ] ++ lib.optional cfg.database.enable "postgresql.target";

      environment = {
        NODE_ENV = "production";
        DATABASE_URL = databaseUrl;
        PORT = toString cfg.port;
        PUBLIC_SERVER_URL = cfg.publicServerUrl;
        TRUSTED_ORIGINS = lib.concatStringsSep "," ([ cfg.publicServerUrl ] ++ cfg.trustedOrigins);
        # App-owned data (config.json, splash, user assets) lives in the
        # persistent state dir; bulk clips live in storageDir; encode scratch
        # is wipeable cache.
        ALLOY_DATA_DIR = cfg.stateDir;
        ALLOY_CLIPS_DIR = cfg.storageDir;
        ALLOY_ENCODE_DIR = encodeDir;
        PGHOST = cfg.database.host;
        PGUSER = cfg.database.user;
        PGDATABASE = cfg.database.name;
      }
      // lib.optionalAttrs (!isDatabaseUnixSocket) {
        PGPORT = toString cfg.database.port;
      }
      // cfg.environment;

      inherit preStart;

      serviceConfig = {
        ExecStart = lib.getExe cfg.package;
        User = cfg.user;
        Group = cfg.group;
        WorkingDirectory = cfg.stateDir;
        Restart = "on-failure";
        RestartSec = 5;
        UMask = "0077";

        NoNewPrivileges = true;
        PrivateDevices = cfg.accelerationDevices == [ ];
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        DeviceAllow = lib.mkIf (cfg.accelerationDevices != null) cfg.accelerationDevices;
        StateDirectory = lib.mkIf (managedStateDirectory != null) managedStateDirectory;
        CacheDirectory = lib.mkIf (managedCacheDirectory != null) managedCacheDirectory;
        ReadWritePaths = serverExternalWritePaths;
      }
      // lib.optionalAttrs (managedStateDirectory != null) {
        StateDirectoryMode = "0750";
      }
      // lib.optionalAttrs (managedCacheDirectory != null) {
        CacheDirectoryMode = "0750";
      };
    };

  };
}
