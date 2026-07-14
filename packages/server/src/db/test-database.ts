import { createPostgresPool, migrateDatabase } from "@alloy/db"
import { escapeIdentifier } from "pg"

export async function prepareTestDatabase(name: string): Promise<string> {
  const source = process.env.ALLOY_TEST_DATABASE_URL
  if (!source) throw new Error("ALLOY_TEST_DATABASE_URL is not set")
  requireTestSecret("ALLOY_VIEWER_COOKIE_SECRET")
  requireTestSecret("ALLOY_UPLOAD_HMAC_SECRET")

  const sourceUrl = new URL(source)
  const database = `${databaseName(sourceUrl)}_${name}`
  const maintenanceUrl = new URL(source)
  maintenanceUrl.pathname = "/postgres"

  const databaseIdentifier = escapeIdentifier(database)
  const dropDatabaseStatement = [
    "drop database if exists",
    databaseIdentifier,
    "with (force)",
  ].join(" ")
  const createDatabaseStatement = ["create database", databaseIdentifier].join(
    " ",
  )
  const client = createPostgresPool(maintenanceUrl.toString(), { max: 1 })
  try {
    await client.query(dropDatabaseStatement)
    await client.query(createDatabaseStatement)
  } finally {
    await client.end()
  }

  const databaseUrl = new URL(source)
  databaseUrl.pathname = `/${database}`
  const url = databaseUrl.toString()

  process.env.NODE_ENV = "test"
  process.env.DATABASE_URL = url

  await migrateDatabase(url)
  return url
}

function databaseName(url: URL) {
  const name = decodeURIComponent(url.pathname.slice(1))
  if (!name) throw new Error("ALLOY_TEST_DATABASE_URL must include a database")
  return name
}

function requireTestSecret(
  name: "ALLOY_VIEWER_COOKIE_SECRET" | "ALLOY_UPLOAD_HMAC_SECRET",
): void {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not set`)
  if (value.length < 32)
    throw new Error(`${name} must be at least 32 characters`)
}
