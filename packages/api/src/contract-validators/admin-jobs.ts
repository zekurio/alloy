import {
  type AdminFailedJobsPage,
  AdminFailedJobsPageSchema,
  type AdminJobEnqueueResponse,
  AdminJobEnqueueResponseSchema,
  type AdminJobsSummary,
  AdminJobsSummarySchema,
} from "@alloy/contracts"

import type { ApiJsonInput } from "../json-value"

export function validateAdminJobEnqueueResponse(
  value: ApiJsonInput,
): AdminJobEnqueueResponse {
  return AdminJobEnqueueResponseSchema.parse(value)
}

export function validateAdminJobsSummary(
  value: ApiJsonInput,
): AdminJobsSummary {
  return AdminJobsSummarySchema.parse(value)
}

export function validateAdminFailedJobsPage(
  value: ApiJsonInput,
): AdminFailedJobsPage {
  return AdminFailedJobsPageSchema.parse(value)
}
