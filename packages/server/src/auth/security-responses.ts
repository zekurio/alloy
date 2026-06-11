import { isoDate } from "@alloy/server/runtime/date"

type PublicPasskeyRow = {
  id: string
  name: string | null
  createdAt: Date
  deviceType: string
}

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
    createdAt: isoDate(row.createdAt),
    deviceType: row.deviceType,
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
