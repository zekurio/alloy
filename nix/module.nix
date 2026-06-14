{ self }:

{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.alloy-clips;

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
    cfg.storage.fs.usersPath
  ];
  serverExternalWritePaths = lib.unique (
    lib.optionals (managedStateDirectory == null) [ cfg.stateDir ]
    ++ lib.optionals (cfg.storage.driver == "fs") (
      lib.filter (path: !(pathIsUnder cfg.stateDir path)) fsStoragePaths
    )
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
  hasEnvSecret =
    name:
    hasEnv name || hasEnv "${name}_FILE";
  credentialSpecs =
    lib.optional
      (
        cfg.secrets.viewerCookieSecretFile != null
        && !(hasEnvSecret "ALLOY_VIEWER_COOKIE_SECRET")
      )
      {
      name = "viewer-cookie-secret";
      path = cfg.secrets.viewerCookieSecretFile;
      env = "ALLOY_VIEWER_COOKIE_SECRET_FILE";
    }
    ++ lib.optional
      (
        cfg.secrets.uploadHmacSecretFile != null
        && !(hasEnvSecret "ALLOY_UPLOAD_HMAC_SECRET")
      )
      {
      name = "upload-hmac-secret";
      path = cfg.secrets.uploadHmacSecretFile;
      env = "ALLOY_UPLOAD_HMAC_SECRET_FILE";
    }
    ++ lib.optional
      (
        cfg.integrations.steamgriddb.apiKeyFile != null
        && !(hasEnvSecret "ALLOY_STEAMGRIDDB_API_KEY")
      )
      {
      name = "steamgriddb-api-key";
      path = cfg.integrations.steamgriddb.apiKeyFile;
      env = "ALLOY_STEAMGRIDDB_API_KEY_FILE";
    }
    ++ lib.optional
      (
        cfg.storage.s3.accessKeyIdFile != null
        && !(hasEnvSecret "ALLOY_STORAGE_S3_ACCESS_KEY_ID")
      )
      {
      name = "s3-access-key-id";
      path = cfg.storage.s3.accessKeyIdFile;
      env = "ALLOY_STORAGE_S3_ACCESS_KEY_ID_FILE";
    }
    ++ lib.optional
      (
        cfg.storage.s3.secretAccessKeyFile != null
        && !(hasEnvSecret "ALLOY_STORAGE_S3_SECRET_ACCESS_KEY")
      )
      {
      name = "s3-secret-access-key";
      path = cfg.storage.s3.secretAccessKeyFile;
      env = "ALLOY_STORAGE_S3_SECRET_ACCESS_KEY_FILE";
    }
    ++ lib.optional
      (
        cfg.oauth.socialAccountProvidersFile != null
        && !(hasEnvSecret "ALLOY_SOCIALACCOUNT_PROVIDERS")
      )
      {
      name = "socialaccount-providers";
      path = cfg.oauth.socialAccountProvidersFile;
      env = "ALLOY_SOCIALACCOUNT_PROVIDERS_FILE";
    };
  credentialEnvironment = builtins.listToAttrs (
    map (credential: {
      name = credential.env;
      value = "%d/${credential.name}";
    }) credentialSpecs
  );
  loadCredentials = map (
    credential: "${credential.name}:${toString credential.path}"
  ) credentialSpecs;
in
{
  imports = [
    (lib.mkRenamedOptionModule
      [ "services" "alloy-clips" "database" "createLocally" ]
      [ "services" "alloy-clips" "database" "enable" ]
    )
    (lib.mkRenamedOptionModule
      [ "services" "alloy-clips" "clipsStorageDir" ]
      [ "services" "alloy-clips" "storage" "fs" "clipsPath" ]
    )
    (lib.mkRenamedOptionModule
      [ "services" "alloy-clips" "userAssetsStorageDir" ]
      [ "services" "alloy-clips" "storage" "fs" "usersPath" ]
    )
    (lib.mkRemovedOptionModule [ "services" "alloy-clips" "storageDir" ] ''
      Configure services.alloy-clips.storage.fs.clipsPath and
      services.alloy-clips.storage.fs.usersPath directly.
    '')
    (lib.mkRemovedOptionModule [ "services" "alloy-clips" "configFile" ] ''
      Alloy no longer reads mutable config.json. Use typed NixOS options under
      services.alloy-clips or services.alloy-clips.environment.
    '')
    (lib.mkRemovedOptionModule [ "services" "alloy-clips" "initialRuntimeConfig" ] ''
      Alloy no longer bootstraps mutable runtime config. Use typed NixOS
      options under services.alloy-clips or services.alloy-clips.environment.
    '')
    (lib.mkRemovedOptionModule [ "services" "alloy-clips" "database" "url" ] ''
      Configure services.alloy-clips.database.host, port, name, and user instead.
      The module derives DATABASE_URL like the Immich module. For unusual
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
    (lib.mkRemovedOptionModule [ "services" "alloy-clips" "accelerationDevices" ] ''
      Alloy no longer transcodes on the server (the desktop app owns all
      encoding), so the service needs no hardware encoder device access.
    '')
    (lib.mkRemovedOptionModule [ "services" "alloy-clips" "cacheDir" ] ''
      Alloy now keeps temporary media work/cache files in the OS temp area.
      Configure durable storage through services.alloy-clips.storage.
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

    secrets = {
      viewerCookieSecretFile = lib.mkOption {
        type = lib.types.nullOr lib.types.path;
        default = null;
        example = "/run/secrets/alloy-viewer-cookie-secret";
        description = "File containing the viewer cookie signing secret.";
      };

      uploadHmacSecretFile = lib.mkOption {
        type = lib.types.nullOr lib.types.path;
        default = null;
        example = "/run/secrets/alloy-upload-hmac-secret";
        description = "File containing the upload ticket HMAC signing secret.";
      };
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
          "s3"
        ];
        default = "fs";
        description = "Storage backend for clips and user assets.";
      };

      fs = {
        clipsPath = lib.mkOption {
          type = lib.types.path;
          default = "${cfg.stateDir}/storage/clips";
          defaultText = lib.literalExpression ''"\${config.services.alloy-clips.stateDir}/storage/clips"'';
          description = "Filesystem root for clip sources, thumbnails, and derived media.";
        };

        usersPath = lib.mkOption {
          type = lib.types.path;
          default = "${cfg.stateDir}/storage/users";
          defaultText = lib.literalExpression ''"\${config.services.alloy-clips.stateDir}/storage/users"'';
          description = "Filesystem root for user assets such as avatars and banners.";
        };
      };

      s3 = {
        bucket = lib.mkOption {
          type = lib.types.str;
          default = "";
          description = "S3 bucket name.";
        };

        region = lib.mkOption {
          type = lib.types.str;
          default = "";
          description = "S3 region. Use \"auto\" for Cloudflare R2.";
        };

        endpoint = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          default = null;
          example = "https://s3.example.com";
          description = "Optional S3-compatible endpoint URL.";
        };

        forcePathStyle = lib.mkOption {
          type = lib.types.bool;
          default = false;
          description = "Use path-style S3 URLs.";
        };

        accessKeyIdFile = lib.mkOption {
          type = lib.types.nullOr lib.types.path;
          default = null;
          example = "/run/secrets/alloy-s3-access-key-id";
          description = "File containing the S3 access key ID.";
        };

        secretAccessKeyFile = lib.mkOption {
          type = lib.types.nullOr lib.types.path;
          default = null;
          example = "/run/secrets/alloy-s3-secret-access-key";
          description = "File containing the S3 secret access key.";
        };
      };
    };

    integrations.steamgriddb.apiKeyFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      example = "/run/secrets/alloy-steamgriddb-api-key";
      description = "Optional file containing the SteamGridDB API key.";
    };

    oauth.socialAccountProvidersFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      example = "/run/secrets/alloy-socialaccount-providers.json";
      description = ''
        Optional Paperless/allauth-style JSON file for OpenID Connect providers.
        The file may contain client secrets and is passed through a systemd
        credential, not copied into the Nix store by the module.
      '';
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
          cfg.secrets.viewerCookieSecretFile != null
          || hasEnvSecret "ALLOY_VIEWER_COOKIE_SECRET";
        message = "Set services.alloy-clips.secrets.viewerCookieSecretFile or ALLOY_VIEWER_COOKIE_SECRET(_FILE).";
      }
      {
        assertion =
          cfg.secrets.uploadHmacSecretFile != null
          || hasEnvSecret "ALLOY_UPLOAD_HMAC_SECRET";
        message = "Set services.alloy-clips.secrets.uploadHmacSecretFile or ALLOY_UPLOAD_HMAC_SECRET(_FILE).";
      }
      {
        assertion =
          cfg.storage.driver != "s3"
          || cfg.storage.s3.bucket != "";
        message = "services.alloy-clips.storage.s3.bucket is required when storage.driver is s3.";
      }
      {
        assertion =
          cfg.storage.driver != "s3"
          || cfg.storage.s3.region != "";
        message = "services.alloy-clips.storage.s3.region is required when storage.driver is s3.";
      }
      {
        assertion =
          cfg.storage.driver != "s3"
          || cfg.storage.s3.accessKeyIdFile != null
          || hasEnvSecret "ALLOY_STORAGE_S3_ACCESS_KEY_ID";
        message = "Set services.alloy-clips.storage.s3.accessKeyIdFile or ALLOY_STORAGE_S3_ACCESS_KEY_ID(_FILE) for S3.";
      }
      {
        assertion =
          cfg.storage.driver != "s3"
          || cfg.storage.s3.secretAccessKeyFile != null
          || hasEnvSecret "ALLOY_STORAGE_S3_SECRET_ACCESS_KEY";
        message = "Set services.alloy-clips.storage.s3.secretAccessKeyFile or ALLOY_STORAGE_S3_SECRET_ACCESS_KEY(_FILE) for S3.";
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

    systemd.tmpfiles.rules = lib.optionals (cfg.storage.driver == "fs") (
      map (path: "e ${path} 0750 ${cfg.user} ${cfg.group} - -") (
        lib.filter (path: !(pathIsUnder cfg.stateDir path)) fsStoragePaths
      )
    );

    systemd.services.alloy-clips = {
      description = "Alloy clip sharing server";
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
          ALLOY_STORAGE_FS_USERS_PATH = toString cfg.storage.fs.usersPath;
          ALLOY_STORAGE_S3_BUCKET = cfg.storage.s3.bucket;
          ALLOY_STORAGE_S3_REGION = cfg.storage.s3.region;
          ALLOY_STORAGE_S3_FORCE_PATH_STYLE = lib.boolToString cfg.storage.s3.forcePathStyle;
          PGHOST = cfg.database.host;
          PGUSER = cfg.database.user;
          PGDATABASE = cfg.database.name;
        }
        // lib.optionalAttrs (cfg.limits.defaultStorageQuotaBytes != null) {
          ALLOY_DEFAULT_STORAGE_QUOTA_BYTES = toString cfg.limits.defaultStorageQuotaBytes;
        }
        // lib.optionalAttrs (cfg.storage.s3.endpoint != null) {
          ALLOY_STORAGE_S3_ENDPOINT = cfg.storage.s3.endpoint;
        }
        // lib.optionalAttrs (!isDatabaseUnixSocket) {
          PGPORT = toString cfg.database.port;
        }
        // credentialEnvironment
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
          PrivateDevices = true;
          PrivateTmp = true;
          ProtectSystem = "strict";
          ProtectHome = true;
          StateDirectory = lib.mkIf (managedStateDirectory != null) managedStateDirectory;
          ReadWritePaths = serverExternalWritePaths;
          LoadCredential = loadCredentials;
        }
        // lib.optionalAttrs (managedStateDirectory != null) {
          StateDirectoryMode = "0750";
        };
    };
  };
}
