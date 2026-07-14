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

export function adminUserFieldsEqual(
  left: AdminUserEditableFields,
  right: AdminUserEditableFields,
): boolean {
  return (
    left.role === right.role &&
    left.storageQuotaBytes === right.storageQuotaBytes
  )
}
