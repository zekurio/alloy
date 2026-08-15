import {
  type AdminFailedJobsPage,
  AdminFailedJobsPageSchema,
  type AdminJobEnqueueResponse,
  AdminJobEnqueueResponseSchema,
  type AdminJobsSummary,
  AdminJobsSummarySchema,
} from "@alloy/contracts"

export function validateAdminJobEnqueueResponse(
  value: unknown,
): AdminJobEnqueueResponse {
  return AdminJobEnqueueResponseSchema.parse(value)
}

export function validateAdminJobsSummary(value: unknown): AdminJobsSummary {
  return AdminJobsSummarySchema.parse(value)
}

export function validateAdminFailedJobsPage(
  value: unknown,
): AdminFailedJobsPage {
  return AdminFailedJobsPageSchema.parse(value)
}
