import type { AdminUserStorageRow } from "@alloy/api"

import { normalizeRole } from "./admin-user-role"

export type AdminUserRow = AdminUserStorageRow

export type AdminUserEditableFields = {
  role: "admin" | "user"
  storageQuotaBytes: number | null
}

export function adminUserEditableFields(
  user: AdminUserRow,
): AdminUserEditableFields {
  return {
    role: normalizeRole(user.role),
    storageQuotaBytes: user.storageQuotaBytes,
  }
}

/** The edited fields that differ from the stored user, or null if none do. */
export function adminUserFieldChanges(
  user: AdminUserRow,
  next: AdminUserEditableFields,
): Partial<AdminUserEditableFields> | null {
  const current = adminUserEditableFields(user)
  const changes: Partial<AdminUserEditableFields> = {}
  if (current.role !== next.role) changes.role = next.role
  if (current.storageQuotaBytes !== next.storageQuotaBytes) {
    changes.storageQuotaBytes = next.storageQuotaBytes
  }
  return Object.keys(changes).length > 0 ? changes : null
}

export function adminUserIsBanned(user: AdminUserRow): boolean {
  return user.adminSuspendedAt === undefined
    ? user.status === "disabled"
    : user.adminSuspendedAt !== null
}
