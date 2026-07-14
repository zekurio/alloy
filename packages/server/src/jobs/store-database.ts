import { job } from "@alloy/db/schema"
import { and, eq } from "drizzle-orm"

export function leasedRunningJob(id: string, leaseToken: string) {
  return and(
    eq(job.id, id),
    eq(job.lease_token, leaseToken),
    eq(job.status, "running"),
  )
}
