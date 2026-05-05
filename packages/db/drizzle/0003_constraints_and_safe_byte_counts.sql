ALTER TABLE "user"
  ADD CONSTRAINT "user_role_check" CHECK ("role" in ('user', 'admin')) NOT VALID;

ALTER TABLE "user"
  ADD CONSTRAINT "user_status_check" CHECK ("status" in ('active', 'disabled')) NOT VALID;

ALTER TABLE "user"
  ADD CONSTRAINT "user_storage_quota_bytes_safe_check"
  CHECK ("storage_quota_bytes" is null or ("storage_quota_bytes" >= 0 and "storage_quota_bytes" <= 9007199254740991)) NOT VALID;

ALTER TABLE "clip"
  ADD CONSTRAINT "clip_privacy_check" CHECK ("privacy" in ('public', 'unlisted', 'private')) NOT VALID;

ALTER TABLE "clip"
  ADD CONSTRAINT "clip_status_check" CHECK ("status" in ('pending', 'uploaded', 'encoding', 'ready', 'failed')) NOT VALID;

ALTER TABLE "clip"
  ADD CONSTRAINT "clip_size_bytes_safe_check"
  CHECK ("size_bytes" is null or ("size_bytes" >= 0 and "size_bytes" <= 9007199254740991)) NOT VALID;

ALTER TABLE "clip_upload_ticket"
  ADD CONSTRAINT "clip_upload_ticket_role_check" CHECK ("role" in ('video', 'thumbnail')) NOT VALID;

ALTER TABLE "clip_upload_ticket"
  ADD CONSTRAINT "clip_upload_ticket_expected_bytes_safe_check"
  CHECK ("expected_bytes" > 0 and "expected_bytes" <= 9007199254740991) NOT VALID;

ALTER TABLE "notification"
  ADD CONSTRAINT "notification_type_check"
  CHECK ("type" in ('clip_upload_failed', 'new_follower', 'clip_comment', 'comment_reply', 'comment_pinned', 'comment_liked_by_author', 'new_video')) NOT VALID;
