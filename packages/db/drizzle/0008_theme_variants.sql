ALTER TABLE "user_theme" ADD COLUMN "variants" jsonb;--> statement-breakpoint
UPDATE "user_theme" SET "variants" =
	CASE WHEN "light" IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('id', 'light', 'name', NULL, 'appearance', 'light', 'colors', "light")) END
	|| CASE WHEN "dark" IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('id', 'dark', 'name', NULL, 'appearance', 'dark', 'colors', "dark")) END;--> statement-breakpoint
ALTER TABLE "user_theme" DROP CONSTRAINT "user_theme_appearance_check";--> statement-breakpoint
ALTER TABLE "user_theme" ALTER COLUMN "variants" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_theme" DROP COLUMN "light";--> statement-breakpoint
ALTER TABLE "user_theme" DROP COLUMN "dark";--> statement-breakpoint
ALTER TABLE "user_theme" ADD CONSTRAINT "user_theme_variants_check" CHECK (jsonb_typeof("user_theme"."variants") = 'array' and jsonb_array_length("user_theme"."variants") > 0);