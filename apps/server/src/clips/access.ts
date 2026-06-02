import { eq } from "drizzle-orm"
import type { Context } from "hono"

import { user } from "@workspace/db/auth-schema"
import { clip } from "@workspace/db/schema"

import { getSession } from "../auth/session"
import { db } from "../db"
import { errorResult } from "../runtime/http-response"

type ClipViewer = { id: string; role: string | null } | null

type ClipAccessReadiness = "ready" | "ready-or-owner-admin"
type ClipPrivateFailure = "not-found" | "auth"

type ClipAccessPolicy = {
  allowPrivate: boolean
  notReadyError: string
  privateFailure: ClipPrivateFailure
  readiness: ClipAccessReadiness
}

const CLIP_ACCESS_POLICIES = {
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
  openGraphAsset: {
    allowPrivate: false,
    notReadyError: "Not found",
    privateFailure: "not-found",
    readiness: "ready",
  },
} as const satisfies Record<string, ClipAccessPolicy>

type ClipAccessPolicyName = keyof typeof CLIP_ACCESS_POLICIES
type ClipAccessStatus = 401 | 403 | 404

type ClipAccessAllowed = {
  accessible: true
  row: typeof clip.$inferSelect
  viewer: ClipViewer
  isOwner: boolean
  isAdmin: boolean
  isPrivate: boolean
}

type ClipAccessDenied = {
  accessible: false
  error: string
  status: ClipAccessStatus
  isPrivate: boolean
}

type ClipAccessResult = ClipAccessAllowed | ClipAccessDenied

async function peekClipViewer(headers: Headers): Promise<ClipViewer> {
  const session = await getSession(headers)
  if (!session) return null
  return {
    id: session.user.id,
    role: (session.user as { role?: string | null }).role ?? null,
  }
}

export async function resolveClipAccess({
  id,
  headers,
  policy,
}: {
  id: string
  headers: Headers
  policy: ClipAccessPolicyName
}): Promise<ClipAccessResult> {
  const [selected] = await db
    .select({
      row: clip,
      authorDisabledAt: user.disabledAt,
    })
    .from(clip)
    .innerJoin(user, eq(clip.authorId, user.id))
    .where(eq(clip.id, id))
    .limit(1)

  if (!selected) {
    return denied("Not found", 404)
  }

  const { row, authorDisabledAt } = selected
  const accessPolicy = CLIP_ACCESS_POLICIES[policy]
  const viewer = await peekClipViewer(headers)
  const isOwner = viewer?.id === row.authorId
  const isAdmin = viewer?.role === "admin"
  const isPrivate = row.privacy === "private"
  const canBypassVisibility = isOwner || isAdmin

  if (authorDisabledAt && !canBypassVisibility) {
    return denied("Not found", 404, isPrivate)
  }

  if (isPrivate) {
    if (!accessPolicy.allowPrivate) {
      return denied("Not found", 404, true)
    }
    if (!canBypassVisibility) {
      return privateDenied(accessPolicy.privateFailure, viewer)
    }
  }

  if (!canReadStatus(row.status, accessPolicy.readiness, canBypassVisibility)) {
    return denied(accessPolicy.notReadyError, 404, isPrivate)
  }

  return {
    accessible: true,
    row,
    viewer,
    isOwner,
    isAdmin,
    isPrivate,
  }
}

export function clipAccessResponse(c: Context, access: ClipAccessDenied) {
  if (access.isPrivate) c.header("Cache-Control", "no-store")
  return errorResult(c, access)
}

export function applyClipPrivacyHeaders(c: Context, access: ClipAccessAllowed) {
  if (access.isPrivate) c.header("Cache-Control", "no-store")
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

function denied(
  error: string,
  status: ClipAccessStatus,
  isPrivate = false,
): ClipAccessDenied {
  return { accessible: false, error, status, isPrivate }
}
