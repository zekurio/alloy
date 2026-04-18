import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import * as authSchema from "./auth-schema"
import * as schema from "./schema"

export { authSchema, schema }
export * from "./auth-schema"
export * from "./schema"

export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 10 })
  const db = drizzle(client, {
    schema: { ...authSchema, ...schema },
  })

  return { client, db }
}

export type Db = ReturnType<typeof createDb>["db"]
