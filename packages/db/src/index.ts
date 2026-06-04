import { drizzle } from "drizzle-orm/node-postgres"

import { authSchema } from "./auth-schema"
import { createPostgresPool } from "./connection.ts"
import { domainSchema } from "./schema"

export { authSchema, domainSchema }
export { createPostgresPool } from "./connection.ts"
export { migrateDatabase } from "./migrate"
export * from "./auth-schema"
export * from "./schema"

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

export type Db = ReturnType<typeof createDb>["db"]
