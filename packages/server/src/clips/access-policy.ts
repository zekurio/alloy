import type { UserRole, UserStatus } from "@alloy/contracts"

export type ClipViewer = {
  id: string
  role: UserRole
  status: UserStatus
} | null

type ClipAccessReadiness = "ready" | "ready-or-owner-admin"

type ClipAccessPolicy = {
  notReadyError: string
  readiness: ClipAccessReadiness
}

const CLIP_ACCESS_POLICIES = {
  metadata: {
    notReadyError: "Not found",
    readiness: "ready-or-owner-admin",
  },
  engagement: {
    notReadyError: "Not found",
    readiness: "ready",
  },
  stream: {
    notReadyError: "Clip not ready",
    readiness: "ready",
  },
  ownerAsset: {
    notReadyError: "Not found",
    readiness: "ready-or-owner-admin",
  },
} as const satisfies Record<string, ClipAccessPolicy>

export type ClipAccessPolicyName = keyof typeof CLIP_ACCESS_POLICIES
export type ClipAccessDenied = {
  accessible: false
  error: string
  status: 404
}

export type ClipAccessInput = {
  policy: ClipAccessPolicyName
  viewer: ClipViewer
  authorId: string
  privacy: string
  status: string
  authorDisabledAt: Date | null
}

export type ClipAccessDecision =
  | {
      accessible: true
      isOwner: boolean
      isAdmin: boolean
    }
  | ClipAccessDenied

/**
 * Public clips are discoverable, unlisted clips are reachable by anyone with
 * the id, and private clips are owner/admin-only. Readiness remains policy
 * specific so owners can still manage in-flight uploads.
 */
export function evaluateClipAccess(input: ClipAccessInput): ClipAccessDecision {
  const accessPolicy = CLIP_ACCESS_POLICIES[input.policy]
  const isOwner =
    input.viewer?.status === "active" && input.viewer.id === input.authorId
  const isAdmin =
    input.viewer?.status === "active" && input.viewer.role === "admin"
  const canBypassVisibility = isOwner || isAdmin

  if (input.authorDisabledAt && !canBypassVisibility) {
    return denied("Not found")
  }

  if (input.privacy === "private" && !canBypassVisibility) {
    return denied("Not found")
  }

  if (
    !canReadStatus(input.status, accessPolicy.readiness, canBypassVisibility)
  ) {
    return denied(accessPolicy.notReadyError)
  }

  return { accessible: true, isOwner, isAdmin }
}

function canReadStatus(
  status: string,
  readiness: ClipAccessReadiness,
  canBypassVisibility: boolean,
): boolean {
  if (status === "ready") return true
  return readiness === "ready-or-owner-admin" && canBypassVisibility
}

export function denied(error: string): ClipAccessDenied {
  return { accessible: false, error, status: 404 }
}
