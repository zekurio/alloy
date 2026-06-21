import { isoDate } from "@alloy/server/runtime/date"

type PublicPasskeyRow = {
  id: string
  name: string | null
} & (
  | { createdAt: Date; deviceType: string }
  | { created_at: Date; device_type: string }
)

type PublicLinkedAccountRow = {
  id: string
  providerId: string
  accountId: string
  email: string | null
  createdAt: Date
}

export function publicPasskeyRow(row: PublicPasskeyRow) {
  return {
    id: row.id,
    name: row.name,
    createdAt: isoDate("createdAt" in row ? row.createdAt : row.created_at),
    deviceType: "deviceType" in row ? row.deviceType : row.device_type,
  }
}

export function publicLinkedAccountRow(row: PublicLinkedAccountRow) {
  return {
    id: row.id,
    providerId: row.providerId,
    accountId: row.accountId,
    email: row.email,
    createdAt: isoDate(row.createdAt),
  }
}
