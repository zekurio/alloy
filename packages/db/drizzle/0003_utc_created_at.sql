-- App sessions used to start in the database server's time zone, so `now()`
-- defaults stored local wall time in these `timestamp` columns while the app
-- reads them as UTC. The app now starts its sessions in UTC. Migrations still
-- run in the old session time zone, so convert from it, assuming it has not
-- changed since the rows were written. Rows from the repeated hour when
-- daylight saving time ends are ambiguous, and PostgreSQL picks one of the
-- two offsets, so they may end up an hour off. Only `created_at` qualifies:
-- the app never writes it, while `updated_at` mixes default-written local
-- times with app-written UTC times.
DO $$
DECLARE
  tz text := current_setting('TimeZone');
BEGIN
  -- Skip the rewrite when the zone matches UTC in winter and summer.
  IF ('2000-01-15 12:00'::timestamp AT TIME ZONE tz)
       = ('2000-01-15 12:00'::timestamp AT TIME ZONE 'UTC')
     AND ('2000-07-15 12:00'::timestamp AT TIME ZONE tz)
       = ('2000-07-15 12:00'::timestamp AT TIME ZONE 'UTC') THEN
    RETURN;
  END IF;

  UPDATE "user" SET "created_at" = ("created_at" AT TIME ZONE tz) AT TIME ZONE 'UTC';
  UPDATE "auth_session" SET "created_at" = ("created_at" AT TIME ZONE tz) AT TIME ZONE 'UTC';
  UPDATE "user_passkey" SET "created_at" = ("created_at" AT TIME ZONE tz) AT TIME ZONE 'UTC';
  UPDATE "auth_account" SET "created_at" = ("created_at" AT TIME ZONE tz) AT TIME ZONE 'UTC';
  UPDATE "auth_challenge" SET "created_at" = ("created_at" AT TIME ZONE tz) AT TIME ZONE 'UTC';
  UPDATE "clip" SET "created_at" = ("created_at" AT TIME ZONE tz) AT TIME ZONE 'UTC';
  UPDATE "clip_rendition" SET "created_at" = ("created_at" AT TIME ZONE tz) AT TIME ZONE 'UTC';
  UPDATE "clip_view" SET "created_at" = ("created_at" AT TIME ZONE tz) AT TIME ZONE 'UTC';
  UPDATE "game" SET "created_at" = ("created_at" AT TIME ZONE tz) AT TIME ZONE 'UTC';
  UPDATE "game_detection_mapping" SET "created_at" = ("created_at" AT TIME ZONE tz) AT TIME ZONE 'UTC';
  UPDATE "upload_ticket" SET "created_at" = ("created_at" AT TIME ZONE tz) AT TIME ZONE 'UTC';
  UPDATE "block" SET "created_at" = ("created_at" AT TIME ZONE tz) AT TIME ZONE 'UTC';
END $$;
