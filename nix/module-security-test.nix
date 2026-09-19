{
  nixpkgs,
  pkgs,
  self,
  system,
}:

let
  assertionMessage = "The effective services.alloy-server PUBLIC_SERVER_URL must use https:// in production.";
  alloyModule = import ./module.nix { inherit self; };
  testPackage = pkgs.writeShellScriptBin "alloy-test" ''
    test "$NODE_ENV" = production
    test "$PUBLIC_SERVER_URL" = https://alloy.example
  '';
  evaluate =
    publicServerUrl: environment:
    nixpkgs.lib.nixosSystem {
      inherit system;
      modules = [
        alloyModule
        {
          system.stateVersion = "26.05";
          services.alloy-server = {
            enable = true;
            package = testPackage;
            database.enable = false;
            environmentFile = "/run/secrets/alloy.env";
            inherit publicServerUrl environment;
          };
        }
      ];
    };
  publicUrlAssertion =
    evaluated:
    pkgs.lib.findFirst (
      item: item.message == assertionMessage
    ) (throw "Alloy HTTPS assertion not found") evaluated.config.assertions;
  productionModeAssertion =
    evaluated:
    pkgs.lib.findFirst (
      item: item.message == "services.alloy-server.environment.NODE_ENV must be production."
    ) (throw "Alloy production mode assertion not found") evaluated.config.assertions;
  requiredPublicUrlAssertion =
    evaluated:
    pkgs.lib.findFirst (
      item:
      item.message
      == "Set services.alloy-server.publicServerUrl or services.alloy-server.environment.PUBLIC_SERVER_URL for production deployments."
    ) (throw "Alloy required public URL assertion not found") evaluated.config.assertions;
  httpsConfiguration = evaluate "https://alloy.example" { };
  httpsAccepted = (publicUrlAssertion httpsConfiguration).assertion;
  httpRejected = !(publicUrlAssertion (evaluate "http://alloy.example" { })).assertion;
  overrideRejected =
    !(
      publicUrlAssertion (
        evaluate "https://alloy.example" {
          PUBLIC_SERVER_URL = "http://override.example";
        }
      )
    ).assertion;
  developmentModeRejected =
    !(
      productionModeAssertion (
        evaluate "https://alloy.example" {
          NODE_ENV = "development";
        }
      )
    ).assertion;
  environmentUrlConfiguration = evaluate null {
    PUBLIC_SERVER_URL = "https://alloy.example";
    ALLOY_UPLOAD_TTL_SEC = "123";
  };
  overriddenUrlConfiguration = evaluate "https://old.example" {
    PUBLIC_SERVER_URL = "https://alloy.example";
  };
  environmentUrlAccepted =
    (requiredPublicUrlAssertion environmentUrlConfiguration).assertion
    && (publicUrlAssertion environmentUrlConfiguration).assertion;
  environmentOverridesApplied =
    environmentUrlConfiguration.config.systemd.services.alloy-server.environment.ALLOY_UPLOAD_TTL_SEC
    == "123";
  trustedOriginFollowsOverride =
    overriddenUrlConfiguration.config.systemd.services.alloy-server.environment.TRUSTED_ORIGINS
    == "https://alloy.example";
in
assert httpsAccepted;
assert httpRejected;
assert overrideRejected;
assert developmentModeRejected;
assert environmentUrlAccepted;
assert environmentOverridesApplied;
assert trustedOriginFollowsOverride;
pkgs.runCommand "alloy-nixos-module-security-test" { } ''
  NODE_ENV=development \
    PUBLIC_SERVER_URL=http://override.example \
    ${httpsConfiguration.config.systemd.services.alloy-server.serviceConfig.ExecStart}
  NODE_ENV=development \
    PUBLIC_SERVER_URL=http://override.example \
    ${environmentUrlConfiguration.config.systemd.services.alloy-server.serviceConfig.ExecStart}
  touch "$out"
''
