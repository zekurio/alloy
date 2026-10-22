import { t } from "@alloy/contracts/schema"

const PostgreSqlErrorSchema = t.object({
  cause: t.unknown().optional(),
  code: t.string().optional(),
})

/** SQLSTATE 23505: a unique index or constraint rejected the write. */
export const POSTGRES_UNIQUE_VIOLATION = "23505"

export function postgresErrorHasCode(
  cause: unknown,
  expectedCode: string,
): boolean {
  let current = cause
  for (let depth = 0; depth < 4; depth += 1) {
    const parsed = PostgreSqlErrorSchema.safeParse(current)
    if (!parsed.success) return false
    if (parsed.data.code === expectedCode) return true
    current = parsed.data.cause
  }
  return false
}
