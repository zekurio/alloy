{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services."alloy-clips";
  inherit (lib) mkEnableOption mkIf mkOption types;

  isPostgresUnixSocket = lib.hasPrefix "/" cfg.database.host;
  databaseUrl =
    if isPostgresUnixSocket then
      "postgresql:///${cfg.database.name}?host=${cfg.database.host}&user=${cfg.database.user}"
    else
      "postgresql://${cfg.database.user}@${cfg.database.host}:${toString cfg.database.port}/${cfg.database.name}";
in
{
  options.services."alloy-clips" = {
    enable = mkEnableOption "Alloy";

    package = mkOption {
      type = types.package;
      default = pkgs.callPackage ./package.nix { };
      defaultText = lib.literalExpression "pkgs.callPackage ./nix/package.nix { }";
      description = "Alloy package to run.";
    };

    port = mkOption {
      type = types.port;
      default = 3000;
      description = "Port Alloy should listen on.";
    };

    publicServerUrl = mkOption {
      type = types.str;
      default = "http://localhost:3000";
      description = "Public origin for Alloy, used for links, cookies, and generated media URLs.";
    };

    trustedOrigins = mkOption {
      type = types.listOf types.str;
      default = [ ];
      example = [ "https://alloy.example.com" ];
      description = "Additional trusted browser origins. The public server URL is included automatically.";
    };

    openFirewall = mkOption {
      type = types.bool;
      default = false;
      description = "Whether to open the Alloy port in the firewall.";
    };

    user = mkOption {
      type = types.str;
      default = "alloy-clips";
      description = "User account under which Alloy runs.";
    };

    group = mkOption {
      type = types.str;
      default = "alloy-clips";
      description = "Group under which Alloy runs.";
    };

    stateDir = mkOption {
      type = types.path;
      default = "/var/lib/alloy";
      description = "Directory used for Alloy runtime configuration, clip storage, and encoder scratch data.";
    };

    secretsFile = mkOption {
      type = types.nullOr (
        types.str
        // {
          check = value: lib.isString value && types.path.check value;
        }
      );
      default = null;
      example = "/run/secrets/alloy.env";
      description = ''
        Path to an environment file with secrets. This file is not added to the
        Nix store. It may define secret storage credentials or override
        `DATABASE_URL` for external password-protected databases.
      '';
    };

    environment = mkOption {
      type = types.attrsOf types.str;
      default = { };
      example = {
        WEB_DIST_DIR = "/srv/alloy/www";
      };
      description = "Extra environment variables for Alloy.";
    };

    database = {
      enable = mkEnableOption "the PostgreSQL database for Alloy. See services.postgresql" // {
        default = true;
      };

      createDB = mkEnableOption "automatic creation of the PostgreSQL database and user for Alloy" // {
        default = true;
      };

      name = mkOption {
        type = types.str;
        default = "alloy";
        description = "PostgreSQL database name.";
      };

      host = mkOption {
        type = types.str;
        default = "/run/postgresql";
        example = "127.0.0.1";
        description = ''
          PostgreSQL host. If this is an absolute path, Alloy connects through
          that Unix socket directory.
        '';
      };

      port = mkOption {
        type = types.port;
        default = 5432;
        description = "PostgreSQL TCP port.";
      };

      user = mkOption {
        type = types.str;
        default = "alloy-clips";
        description = "PostgreSQL user.";
      };
    };
  };

  config = mkIf cfg.enable {
    services.postgresql = mkIf cfg.database.enable {
      enable = true;
      ensureDatabases = mkIf cfg.database.createDB [ cfg.database.name ];
      ensureUsers = mkIf cfg.database.createDB [
        {
          name = cfg.database.user;
          ensureDBOwnership = true;
          ensureClauses.login = true;
        }
      ];
    };

    networking.firewall.allowedTCPPorts = mkIf cfg.openFirewall [ cfg.port ];

    users.users = mkIf (cfg.user == "alloy-clips") {
      alloy-clips = {
        inherit (cfg) group;
        isSystemUser = true;
      };
    };

    users.groups = mkIf (cfg.group == "alloy-clips") {
      alloy-clips = { };
    };

    systemd.tmpfiles.rules = [
      "d ${cfg.stateDir} 0700 ${cfg.user} ${cfg.group} -"
      "d ${cfg.stateDir}/data 0700 ${cfg.user} ${cfg.group} -"
      "d ${cfg.stateDir}/data/storage 0700 ${cfg.user} ${cfg.group} -"
      "d ${cfg.stateDir}/scratch 0700 ${cfg.user} ${cfg.group} -"
    ];

    systemd.services.alloy-clips = {
      description = "Alloy clip sharing server";
      documentation = [ "https://github.com/zekurio/alloy" ];
      wantedBy = [ "multi-user.target" ];
      requires = lib.optionals cfg.database.enable [ "postgresql.target" ];
      after = [ "network.target" ] ++ lib.optionals cfg.database.enable [ "postgresql.target" ];

      environment =
        {
          DATABASE_URL = databaseUrl;
          PORT = toString cfg.port;
          PUBLIC_SERVER_URL = cfg.publicServerUrl;
          TRUSTED_ORIGINS = lib.concatStringsSep "," (
            lib.unique ([ cfg.publicServerUrl ] ++ cfg.trustedOrigins)
          );
          ALLOY_STATE_DIR = toString cfg.stateDir;
          ALLOY_CONFIG_FILE = "${cfg.stateDir}/config.json";
          ENCODE_SCRATCH_DIR = "${cfg.stateDir}/scratch";
        }
        // cfg.environment;

      preStart = ''
        ${lib.getExe' pkgs.coreutils "mkdir"} -p \
          ${lib.escapeShellArg cfg.stateDir} \
          ${lib.escapeShellArg "${cfg.stateDir}/data/storage"} \
          ${lib.escapeShellArg "${cfg.stateDir}/scratch"}

        ${cfg.package}/bin/alloy-migrate
      '';

      serviceConfig = {
        ExecStart = "${cfg.package}/bin/alloy";
        EnvironmentFile = mkIf (cfg.secretsFile != null) cfg.secretsFile;
        Restart = "on-failure";
        RestartSec = 3;
        RuntimeDirectory = "alloy-clips";
        StateDirectory = mkIf (cfg.stateDir == "/var/lib/alloy") "alloy";
        User = cfg.user;
        Group = cfg.group;
        WorkingDirectory = cfg.stateDir;

        CapabilityBoundingSet = "";
        LockPersonality = true;
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectClock = true;
        ProtectControlGroups = true;
        ProtectHome = true;
        ProtectHostname = true;
        ProtectKernelLogs = true;
        ProtectKernelModules = true;
        ProtectKernelTunables = true;
        ProtectSystem = "strict";
        ReadWritePaths = [ cfg.stateDir ];
        RestrictAddressFamilies = [
          "AF_INET"
          "AF_INET6"
          "AF_UNIX"
        ];
        RestrictNamespaces = true;
        RestrictRealtime = true;
        RestrictSUIDSGID = true;
        UMask = "0077";
      };
    };
  };
}
