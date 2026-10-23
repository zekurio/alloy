import {
  type AdminWebhookRow,
  AdminWebhookRowSchema,
  AdminWebhookRowsSchema,
  type AdminWebhookTestResult,
  AdminWebhookTestResultSchema,
  type ContractJsonInput,
} from "@alloy/contracts"

export function validateAdminWebhookRow(
  value: ContractJsonInput,
): AdminWebhookRow {
  return AdminWebhookRowSchema.parse(value)
}

export function validateAdminWebhookRows(
  value: ContractJsonInput,
): AdminWebhookRow[] {
  return AdminWebhookRowsSchema.parse(value)
}

export function validateAdminWebhookTestResult(
  value: ContractJsonInput,
): AdminWebhookTestResult {
  return AdminWebhookTestResultSchema.parse(value)
}
