-- Alloy now has one OpenID Connect provider, keyed "oidc". The provider list,
-- its client secrets, and accounts linked to the old providers have no use.
DELETE FROM "instance_setting" WHERE "key" IN ('oauthProviders', 'oauthClientSecrets');--> statement-breakpoint
DELETE FROM "auth_account" WHERE "provider_id" <> 'oidc';
