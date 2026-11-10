import { drizzle } from "drizzle-orm/node-postgres"

import { createPostgresPool } from "./runtime/connection"
import { domainSchema } from "./schema"
import { authSchema } from "./schema/auth"

export { migrateDatabase } from "./runtime/migrate"
export * from "./schema"
export * from "./schema/auth"

const dbSchema = {
  ...authSchema,
  ...domainSchema,
} as const

export function createDb(databaseUrl: string) {
  const client = createPostgresPool(databaseUrl)

  return {
    client,
    db: drizzle({
      client,
      schema: dbSchema,
    }),
  }
}
