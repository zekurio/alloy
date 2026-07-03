/**
 * Fingerprint of what the media pipeline writes when a run commits: rendition
 * naming, container layout, and ladder semantics. Stored on the clip row at
 * commit; the startup rendition backfill re-encodes any ready clip whose
 * stored fingerprint differs from this value.
 *
 * Bump this whenever a code change alters the committed output format, so
 * existing libraries heal on deploy instead of serving stale-format
 * renditions (settings-only changes don't need a bump — the admin re-encode
 * action covers those).
 */
export const MEDIA_PIPELINE_VERSION = "3"
