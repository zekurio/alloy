export type ClipViewer = { id: string; role: string | null } | null

type ClipAccessReadiness = "ready" | "ready-or-owner-admin"
type ClipPrivateFailure = "not-found" | "auth"

type ClipAccessPolicy = {
  allowPrivate: boolean
  notReadyError: string
  privateFailure: ClipPrivateFailure
  readiness: ClipAccessReadiness
}

export const CLIP_ACCESS_POLICIES = {
  metadata: {
    allowPrivate: true,
    notReadyError: "Not found",
    privateFailure: "not-found",
    readiness: "ready-or-owner-admin",
  },
  engagement: {
    allowPrivate: true,
    notReadyError: "Not found",
    privateFailure: "auth",
    readiness: "ready",
  },
  stream: {
    allowPrivate: true,
    notReadyError: "Clip not ready",
    privateFailure: "auth",
    readiness: "ready",
  },
  ownerAsset: {
    allowPrivate: true,
    notReadyError: "Not found",
    privateFailure: "auth",
    readiness: "ready-or-owner-admin",
  },
} as const satisfies Record<string, ClipAccessPolicy>

export type ClipAccessPolicyName = keyof typeof CLIP_ACCESS_POLICIES
export type ClipAccessStatus = 401 | 403 | 404

export type ClipAccessDenied = {
  accessible: false
  error: string
  status: ClipAccessStatus
  isPrivate: boolean
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
      isPrivate: boolean
    }
  | ClipAccessDenied

export function evaluateClipAccess(input: ClipAccessInput): ClipAccessDecision {
  const accessPolicy = CLIP_ACCESS_POLICIES[input.policy]
  const isOwner = input.viewer?.id === input.authorId
  const isAdmin = input.viewer?.role === "admin"
  const isPrivate = input.privacy === "private"
  const canBypassVisibility = isOwner || isAdmin

  if (input.authorDisabledAt && !canBypassVisibility) {
    return denied("Not found", 404, isPrivate)
  }

  if (isPrivate) {
    if (!accessPolicy.allowPrivate) {
      return denied("Not found", 404, true)
    }
    if (!canBypassVisibility) {
      return privateDenied(accessPolicy.privateFailure, input.viewer)
    }
  }

  if (
    !canReadStatus(input.status, accessPolicy.readiness, canBypassVisibility)
  ) {
    return denied(accessPolicy.notReadyError, 404, isPrivate)
  }

  return {
    accessible: true,
    isOwner,
    isAdmin,
    isPrivate,
  }
}

function canReadStatus(
  status: string,
  readiness: ClipAccessReadiness,
  canBypassVisibility: boolean,
): boolean {
  if (status === "ready") return true
  return readiness === "ready-or-owner-admin" && canBypassVisibility
}

function privateDenied(
  privateFailure: ClipPrivateFailure,
  viewer: ClipViewer,
): ClipAccessDenied {
  if (privateFailure === "not-found") {
    return denied("Not found", 404, true)
  }
  return denied(viewer ? "Forbidden" : "Unauthorized", viewer ? 403 : 401, true)
}

export function denied(
  error: string,
  status: ClipAccessStatus,
  isPrivate = false,
): ClipAccessDenied {
  return { accessible: false, error, status, isPrivate }
}
