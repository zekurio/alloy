import {
  type AdminWebhookRow,
  AdminWebhookRowSchema,
  AdminWebhookRowsSchema,
  type AdminWebhookTestResult,
  AdminWebhookTestResultSchema,
} from "@alloy/contracts"

import type { ApiJsonInput } from "../json-value"

export function validateAdminWebhookRow(value: ApiJsonInput): AdminWebhookRow {
  return AdminWebhookRowSchema.parse(value)
}

export function validateAdminWebhookRows(
  value: ApiJsonInput,
): AdminWebhookRow[] {
  return AdminWebhookRowsSchema.parse(value)
}

export function validateAdminWebhookTestResult(
  value: ApiJsonInput,
): AdminWebhookTestResult {
  return AdminWebhookTestResultSchema.parse(value)
}
