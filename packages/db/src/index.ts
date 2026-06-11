import { drizzle } from "drizzle-orm/node-postgres"

import { createPostgresPool } from "./runtime/connection.ts"
import { domainSchema } from "./schema"
import { authSchema } from "./schema/auth"

export { authSchema, domainSchema }
export { createPostgresPool } from "./runtime/connection.ts"
export { migrateDatabase } from "./runtime/migrate"
export * from "./schema"
export * from "./schema/auth"

export const dbSchema = {
  ...authSchema,
  ...domainSchema,
} as const

export function createDb(databaseUrl: string) {
  const client = createPostgresPool(databaseUrl)
  const db = drizzle({
    client,
    schema: dbSchema,
  })

  return { client, db }
}
