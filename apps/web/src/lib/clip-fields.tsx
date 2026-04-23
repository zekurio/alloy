import { GlobeIcon, Link2Icon, LockIcon } from "lucide-react"

import type { ClipPrivacy } from "@workspace/api"

export const CLIP_TITLE_MAX = 100
export const CLIP_DESCRIPTION_MAX = 2000

export interface PrivacyOption {
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
