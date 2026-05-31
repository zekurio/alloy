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
  machineLearningPackageForSystem =
    self.packages.${pkgs.stdenv.hostPlatform.system}.alloy-machine-learning
      or (throw "alloy machine learning only packages x86_64-linux for now");

  configDir = dirOf cfg.configFile;
  encodeDir = "${cfg.cacheDir}/encode";
  machineLearningBaseUrl =
    if cfg.machine-learning.baseUrl != null then
      cfg.machine-learning.baseUrl
    else
      "http://127.0.0.1:${toString cfg.machine-learning.port}";
  bootstrapConfig =
    if cfg.initialRuntimeConfig == null then
      null
    else
      jsonFormat.generate "alloy-runtime-config.json" cfg.initialRuntimeConfig;

  localDatabaseUrl = "postgres:///${cfg.database.name}";
  staticDatabaseUrl = if cfg.database.url != null then cfg.database.url else localDatabaseUrl;

  startScript = pkgs.writeShellScript "alloy-start" ''
    set -euo pipefail

    ${lib.optionalString (cfg.database.urlFile != null) ''
      export DATABASE_URL="$(< ${lib.escapeShellArg cfg.database.urlFile})"
    ''}
    ${lib.optionalString (cfg.database.urlFile == null) ''
      export DATABASE_URL=${lib.escapeShellArg staticDatabaseUrl}
    ''}

    exec ${lib.escapeShellArg cfg.package}/bin/alloy
  '';

  preStart = ''
    install -d -m 0750 ${lib.escapeShellArg configDir}
    install -d -m 0750 ${lib.escapeShellArg cfg.storageDir}
    install -d -m 0750 ${lib.escapeShellArg encodeDir}
  ''
  + lib.optionalString (bootstrapConfig != null) ''
    if [ ! -e ${lib.escapeShellArg cfg.configFile} ]; then
      install -m 0640 ${lib.escapeShellArg bootstrapConfig} ${lib.escapeShellArg cfg.configFile}
    fi
  '';
in
{
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

    port = lib.mkOption {
      type = lib.types.port;
      default = 3000;
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
      description = "Mutable Alloy state directory.";
    };

    cacheDir = lib.mkOption {
      type = lib.types.path;
      default = "/var/cache/alloy";
      description = "Mutable Alloy cache directory for encoder scratch data.";
    };

    storageDir = lib.mkOption {
      type = lib.types.path;
      default = "${config.services.alloy-clips.stateDir}/storage";
      defaultText = lib.literalExpression ''"\${config.services.alloy-clips.stateDir}/storage"'';
      description = "Filesystem storage root used when Alloy bootstraps runtime config.";
    };

    configFile = lib.mkOption {
      type = lib.types.path;
      default = "${config.services.alloy-clips.stateDir}/runtime-config.json";
      defaultText = lib.literalExpression ''"\${config.services.alloy-clips.stateDir}/runtime-config.json"'';
      description = "Mutable JSON runtime config file used by Alloy and the admin UI.";
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
      createLocally = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Enable and provision a local PostgreSQL database for Alloy.";
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

      socketDir = lib.mkOption {
        type = lib.types.path;
        default = "/run/postgresql";
        description = "PostgreSQL socket directory for local peer-auth connections.";
      };

      url = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        example = "postgres://alloy@db.example.com:5432/alloy";
        description = "Explicit DATABASE_URL. Overrides the generated local socket URL.";
      };

      urlFile = lib.mkOption {
        type = lib.types.nullOr lib.types.path;
        default = null;
        description = "File containing DATABASE_URL. Takes precedence over database.url.";
      };
    };

    machine-learning = {
      enable = lib.mkEnableOption "Alloy's machine learning inference service" // {
        default = true;
      };

      package = lib.mkOption {
        type = lib.types.package;
        default = machineLearningPackageForSystem;
        defaultText =
          lib.literalExpression
            "inputs.alloy.packages.\${pkgs.stdenv.hostPlatform.system}.alloy-machine-learning";
        description = "Alloy machine learning package to run.";
      };

      host = lib.mkOption {
        type = lib.types.str;
        default = "127.0.0.1";
        description = "Address the Alloy machine learning service binds to.";
      };

      port = lib.mkOption {
        type = lib.types.port;
        default = 3003;
        description = "TCP port the Alloy machine learning service listens on.";
      };

      baseUrl = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        example = "http://ml.example.com:3003";
        description = ''
          URL the Alloy server uses to reach the machine learning service. Leave
          null when using the local service managed by this module.
        '';
      };

      cacheDir = lib.mkOption {
        type = lib.types.path;
        default = "${config.services.alloy-clips.cacheDir}/machine-learning";
        defaultText =
          lib.literalExpression ''"\${config.services.alloy-clips.cacheDir}/machine-learning"'';
        description = "Mutable cache directory for model downloads and inference cache.";
      };

      environment = lib.mkOption {
        type = lib.types.attrsOf lib.types.str;
        default = { };
        example = {
          MACHINE_LEARNING_GAME_CLASSIFIER_VERSION = "v1-broad-efficientnet-b2-20260530-202943";
        };
        description = "Additional environment variables for the Alloy machine learning service.";
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
        assertion = !(cfg.database.createLocally && cfg.database.url != null);
        message = "services.alloy-clips.database.url cannot be set when database.createLocally is true.";
      }
      {
        assertion = !(cfg.database.createLocally && cfg.database.urlFile != null);
        message = "services.alloy-clips.database.urlFile cannot be set when database.createLocally is true.";
      }
      {
        assertion = cfg.database.createLocally || cfg.database.url != null || cfg.database.urlFile != null;
        message = "services.alloy-clips.database.url or database.urlFile must be set when database.createLocally is false.";
      }
      {
        assertion = !cfg.database.createLocally || cfg.user == cfg.database.user;
        message = "services.alloy-clips.user must match services.alloy-clips.database.user when database.createLocally is true.";
      }
    ];

    users.groups.${cfg.group} = { };
    users.users.${cfg.user} = {
      isSystemUser = true;
      group = cfg.group;
      extraGroups = cfg.extraGroups;
      home = cfg.stateDir;
    };

    services.postgresql = lib.mkIf cfg.database.createLocally {
      enable = true;
      settings.unix_socket_directories = cfg.database.socketDir;
      ensureDatabases = [ cfg.database.name ];
      ensureUsers = [
        {
          name = cfg.database.user;
          ensureDBOwnership = true;
        }
      ];
    };

    networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [ cfg.port ];

    systemd.tmpfiles.rules = [
      "d ${cfg.stateDir} 0750 ${cfg.user} ${cfg.group} - -"
      "d ${cfg.cacheDir} 0750 ${cfg.user} ${cfg.group} - -"
      "d ${configDir} 0750 ${cfg.user} ${cfg.group} - -"
      "d ${cfg.storageDir} 0750 ${cfg.user} ${cfg.group} - -"
      "d ${encodeDir} 0750 ${cfg.user} ${cfg.group} - -"
    ]
    ++ lib.optional cfg.machine-learning.enable
      "d ${cfg.machine-learning.cacheDir} 0750 ${cfg.user} ${cfg.group} - -";

    systemd.services.alloy-clips = {
      description = "Alloy clip sharing server";
      wantedBy = [ "multi-user.target" ];
      wants =
        [ "network-online.target" ]
        ++ lib.optional cfg.database.createLocally "postgresql.service"
        ++ lib.optional cfg.machine-learning.enable "alloy-machine-learning.service";
      after = [ "network-online.target" ] ++ lib.optional cfg.database.createLocally "postgresql.service";

      environment = {
        NODE_ENV = "production";
        PORT = toString cfg.port;
        PUBLIC_SERVER_URL = cfg.publicServerUrl;
        TRUSTED_ORIGINS = lib.concatStringsSep "," ([ cfg.publicServerUrl ] ++ cfg.trustedOrigins);
        ALLOY_CONFIG_FILE = cfg.configFile;
        ALLOY_STORAGE_DIR = cfg.storageDir;
        ENCODE_SCRATCH_DIR = encodeDir;
      }
      // lib.optionalAttrs cfg.machine-learning.enable {
        MACHINE_LEARNING_ENABLED = "true";
        MACHINE_LEARNING_URL = machineLearningBaseUrl;
      }
      // lib.optionalAttrs (cfg.database.url == null && cfg.database.urlFile == null) {
        PGHOST = cfg.database.socketDir;
        PGUSER = cfg.database.user;
        PGDATABASE = cfg.database.name;
      }
      // cfg.environment;

      inherit preStart;

      serviceConfig = {
        ExecStart = startScript;
        User = cfg.user;
        Group = cfg.group;
        WorkingDirectory = cfg.stateDir;
        Restart = "on-failure";
        RestartSec = 5;
        UMask = "0077";

        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectHome = true;
        ProtectSystem = "strict";
        ReadWritePaths = lib.unique [
          cfg.stateDir
          cfg.cacheDir
          configDir
          cfg.storageDir
        ];
      };
    };

    systemd.services.alloy-machine-learning = lib.mkIf cfg.machine-learning.enable {
      description = "Alloy machine learning inference service";
      wantedBy = [ "multi-user.target" ];
      wants = [ "network-online.target" ];
      after = [ "network-online.target" ];

      environment = {
        ALLOY_ML_HOST = cfg.machine-learning.host;
        ALLOY_ML_PORT = toString cfg.machine-learning.port;
        HF_HOME = "${cfg.machine-learning.cacheDir}/huggingface";
        HF_HUB_CACHE = "${cfg.machine-learning.cacheDir}/huggingface/hub";
        HF_HUB_DISABLE_PROGRESS_BARS = "1";
        HOME = cfg.machine-learning.cacheDir;
        MACHINE_LEARNING_CACHE_FOLDER = cfg.machine-learning.cacheDir;
        XDG_CACHE_HOME = cfg.machine-learning.cacheDir;
      }
      // cfg.machine-learning.environment;

      serviceConfig = {
        ExecStart = lib.getExe cfg.machine-learning.package;
        User = cfg.user;
        Group = cfg.group;
        WorkingDirectory = cfg.stateDir;
        Restart = "on-failure";
        RestartSec = 5;
        UMask = "0077";

        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectHome = true;
        ProtectSystem = "strict";
        ReadWritePaths = lib.unique [
          cfg.machine-learning.cacheDir
        ];
      };
    };
  };
}
