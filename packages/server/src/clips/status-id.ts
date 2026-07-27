// Discord's Mastodon renderer only follows `/api/v1/statuses/:id` when the id
// segment is digits-only. FxEmbed encodes even already-numeric tweet ids for
// this reason (its "snowcode" packs JSON into digits), which is also how it
// routes non-numeric Bluesky and TikTok ids through the same endpoint.
//
// Clip ids are UUIDs, so their 128 bits ride as a decimal integer: exact
// round-trip, no surrogate key, no migration.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// 2^128 - 1 is 39 digits, so anything longer cannot be a clip id.
const STATUS_ID_RE = /^\d{1,39}$/
const MAX_UUID = (1n << 128n) - 1n

export function encodeClipStatusId(clipId: string): string | null {
  if (!UUID_RE.test(clipId)) return null
  return BigInt(`0x${clipId.replaceAll("-", "")}`).toString(10)
}

export function decodeClipStatusId(statusId: string): string | null {
  if (!STATUS_ID_RE.test(statusId)) return null
  const value = BigInt(statusId)
  if (value > MAX_UUID) return null
  // Leading zeros are lost in decimal; padding restores the canonical form.
  const hex = value.toString(16).padStart(32, "0")
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-")
}
