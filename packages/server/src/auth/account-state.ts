import type { UserStatus } from "@alloy/contracts"

export type AccountDisableSource = "administrator" | "self"

export type StoredAccountState = {
  status: UserStatus
  disabledAt: Date | null
  adminSuspendedAt: Date | null
}

export type AccountStateUpdate = StoredAccountState

export function disabledAccountState(
  current: StoredAccountState,
  source: AccountDisableSource,
  now: Date,
): AccountStateUpdate {
  return {
    status: "disabled",
    disabledAt: source === "administrator" ? now : (current.disabledAt ?? now),
    adminSuspendedAt:
      source === "administrator"
        ? (current.adminSuspendedAt ?? now)
        : current.adminSuspendedAt,
  }
}

export function activeAccountState(): AccountStateUpdate {
  return {
    status: "active",
    disabledAt: null,
    adminSuspendedAt: null,
  }
}

export function selfReactivatedAccountState(
  current: StoredAccountState,
): AccountStateUpdate | null {
  if (current.adminSuspendedAt) return null
  return activeAccountState()
}
