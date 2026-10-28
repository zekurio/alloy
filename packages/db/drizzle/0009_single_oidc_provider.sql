-- Alloy now has one OpenID Connect provider, keyed "oidc". With exactly one
-- saved provider, its linked accounts move to the new ID, so their owners,
-- admins included, can sign in again once OIDC points at the same identity
-- provider. Otherwise there is no way to tell which provider OIDC replaces.
UPDATE "auth_account" SET "provider_id" = 'oidc'
WHERE "provider_id" = (
  SELECT "value" -> 0 ->> 'providerId' FROM "instance_setting"
  WHERE "key" = 'oauthProviders'
    AND jsonb_typeof("value") = 'array'
    AND jsonb_array_length("value") = 1
);--> statement-breakpoint
-- The provider list, its client secrets, and accounts linked to any other
-- provider have no use.
DELETE FROM "instance_setting" WHERE "key" IN ('oauthProviders', 'oauthClientSecrets');--> statement-breakpoint
DELETE FROM "auth_account" WHERE "provider_id" <> 'oidc';
