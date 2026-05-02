import { SQL } from "bun"
import { drizzle } from "drizzle-orm/bun-sql"

import { authSchema } from "./auth-schema"
import { domainSchema } from "./schema"

export { authSchema, domainSchema }
export { migrateDatabase } from "./migrate"
export * from "./auth-schema"
export * from "./schema"

export const dbSchema = {
  ...authSchema,
  ...domainSchema,
} as const

export function createDb(databaseUrl: string) {
  const client = new SQL({ url: databaseUrl, max: 10 })
  const db = drizzle({
    client,
    schema: dbSchema,
  })

  return { client, db }
}

export type Db = ReturnType<typeof createDb>["db"]
