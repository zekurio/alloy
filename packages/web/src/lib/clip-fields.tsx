import {
  CLIP_DESCRIPTION_MAX_LENGTH,
  CLIP_TITLE_MAX_LENGTH,
  type ClipPrivacy,
} from "alloy-api"
import { normalizeTags, sanitizeTag } from "alloy-contracts"
import { GlobeIcon, Link2Icon, LockIcon } from "lucide-react"

// Re-exported so callers keep a single import surface for clip field helpers;
// the canonical tag logic lives in alloy-contracts (shared with the server).
export { normalizeTags, sanitizeTag }

export const CLIP_TITLE_MAX = CLIP_TITLE_MAX_LENGTH
export const CLIP_DESCRIPTION_MAX = CLIP_DESCRIPTION_MAX_LENGTH

export function normalizeClipTitle(value: string): string {
  return value.trim()
}

export function normalizeClipDescription(value: string): string {
  return value.trim()
}

export function nullableClipDescription(value: string): string | null {
  const description = normalizeClipDescription(value)
  return description.length > 0 ? description : null
}

/**
 * Parse a free-form hashtag string ("#ace #ranked"), as persisted by the
 * desktop capture store, into the canonical tag list. Splits on
 * whitespace/commas then sanitizes/dedupes via the shared normalizer.
 */
export function parseTagString(value: string): string[] {
  return normalizeTags(value.split(/[\s,]+/))
}

/** Join a tag list back into the space-separated string the store persists. */
export function formatTags(tags: string[]): string {
  return tags.join(" ")
}

interface PrivacyOption {
  value: ClipPrivacy
  label: string
  icon: React.ComponentType<{ className?: string }>
}

export const PRIVACY_OPTIONS: readonly PrivacyOption[] = [
  { value: "public", label: "Public", icon: GlobeIcon },
  { value: "unlisted", label: "Unlisted", icon: Link2Icon },
  { value: "private", label: "Private", icon: LockIcon },
] as const

export const PRIVACY_BY_VALUE: Record<ClipPrivacy, PrivacyOption> =
  Object.fromEntries(PRIVACY_OPTIONS.map((o) => [o.value, o])) as Record<
    ClipPrivacy,
    PrivacyOption
  >
