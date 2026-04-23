import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import { authSchema } from "./auth-schema"
import { domainSchema } from "./schema"

export { authSchema, domainSchema }
export * from "./auth-schema"
export * from "./contracts"
export * from "./schema"

export const dbSchema = {
  ...authSchema,
  ...domainSchema,
} as const

export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 10 })
  const db = drizzle(client, {
    schema: dbSchema,
  })

  return { client, db }
}

export type Db = ReturnType<typeof createDb>["db"]
