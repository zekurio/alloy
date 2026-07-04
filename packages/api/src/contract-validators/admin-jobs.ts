import {
  type AdminFailedJobsPage,
  AdminFailedJobsPageSchema,
  type AdminJobsSummary,
  AdminJobsSummarySchema,
} from "@alloy/contracts"

export function validateAdminJobsSummary(value: unknown): AdminJobsSummary {
  return AdminJobsSummarySchema.parse(value)
}

export function validateAdminFailedJobsPage(
  value: unknown,
): AdminFailedJobsPage {
  return AdminFailedJobsPageSchema.parse(value)
}
