import {
  type AdminWebhookRow,
  AdminWebhookRowSchema,
  AdminWebhookRowsSchema,
  type AdminWebhookTestResult,
  AdminWebhookTestResultSchema,
} from "@alloy/contracts"

export function validateAdminWebhookRow(value: unknown): AdminWebhookRow {
  return AdminWebhookRowSchema.parse(value)
}

export function validateAdminWebhookRows(value: unknown): AdminWebhookRow[] {
  return AdminWebhookRowsSchema.parse(value)
}

export function validateAdminWebhookTestResult(
  value: unknown,
): AdminWebhookTestResult {
  return AdminWebhookTestResultSchema.parse(value)
}
