DROP INDEX "webhook_enabled_idx";--> statement-breakpoint
CREATE INDEX "block_blocked_idx" ON "block" USING btree ("blocked_id");--> statement-breakpoint
CREATE INDEX "auth_account_user_idx" ON "auth_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_passkey_user_idx" ON "user_passkey" USING btree ("user_id");