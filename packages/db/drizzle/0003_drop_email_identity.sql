-- Privacy remodel: Alloy no longer stores email addresses anywhere.
-- OAuth identity is keyed solely on (provider_id, provider_account_id).
-- auth_account.account_label holds the provider username claim so owners can
-- tell linked accounts apart; it starts null and self-heals at next sign-in.
-- Dropping the email columns destroys that data irreversibly.
ALTER TABLE "user" DROP CONSTRAINT "user_email_unique";--> statement-breakpoint
ALTER TABLE "auth_account" DROP COLUMN "email";--> statement-breakpoint
ALTER TABLE "auth_account" ADD COLUMN "account_label" text;--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "email";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "email_verified";
