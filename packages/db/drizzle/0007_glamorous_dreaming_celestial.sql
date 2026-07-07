CREATE TABLE "clip_comment_mention" (
	"comment_id" uuid NOT NULL,
	"mentioned_user_id" uuid NOT NULL,
	CONSTRAINT "clip_comment_mention_comment_id_mentioned_user_id_pk" PRIMARY KEY("comment_id","mentioned_user_id")
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"clip_id" uuid,
	"comment_id" uuid,
	"dedup_key" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_kind_check" CHECK ("notification"."kind" in ('follow', 'clip_like', 'clip_comment', 'comment_reply', 'clip_mention', 'comment_mention', 'comment_like'))
);
--> statement-breakpoint
ALTER TABLE "clip_comment_mention" ADD CONSTRAINT "clip_comment_mention_comment_id_clip_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."clip_comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_comment_mention" ADD CONSTRAINT "clip_comment_mention_mentioned_user_id_user_id_fk" FOREIGN KEY ("mentioned_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_id_user_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_clip_id_clip_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_comment_id_clip_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."clip_comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clip_comment_mention_user_idx" ON "clip_comment_mention" USING btree ("mentioned_user_id");--> statement-breakpoint
CREATE INDEX "notification_recipient_created_idx" ON "notification" USING btree ("recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_recipient_unread_idx" ON "notification" USING btree ("recipient_id") WHERE "notification"."read_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_dedup_idx" ON "notification" USING btree ("recipient_id","dedup_key") WHERE "notification"."dedup_key" is not null;