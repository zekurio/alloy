export type ClipViewer = { id: string; role: string | null } | null

type ClipAccessReadiness = "ready" | "ready-or-owner-admin"

type ClipAccessPolicy = {
  notReadyError: string
  readiness: ClipAccessReadiness
}

export const CLIP_ACCESS_POLICIES = {
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
export type ClipAccessStatus = 401 | 403 | 404

export type ClipAccessDenied = {
  accessible: false
  error: string
  status: ClipAccessStatus
}

export type ClipAccessInput = {
  policy: ClipAccessPolicyName
  viewer: ClipViewer
  authorId: string
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
 * Clips are either public (discoverable) or unlisted (reachable by anyone with
 * the id). The only gate at this layer is readiness (and a disabled author
 * hiding the clip from everyone but the owner/admin).
 */
export function evaluateClipAccess(input: ClipAccessInput): ClipAccessDecision {
  const accessPolicy = CLIP_ACCESS_POLICIES[input.policy]
  const isOwner = input.viewer?.id === input.authorId
  const isAdmin = input.viewer?.role === "admin"
  const canBypassVisibility = isOwner || isAdmin

  if (input.authorDisabledAt && !canBypassVisibility) {
    return denied("Not found", 404)
  }

  if (
    !canReadStatus(input.status, accessPolicy.readiness, canBypassVisibility)
  ) {
    return denied(accessPolicy.notReadyError, 404)
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

export function denied(
  error: string,
  status: ClipAccessStatus,
): ClipAccessDenied {
  return { accessible: false, error, status }
}
