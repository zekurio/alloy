import { createPostgresPool, migrateDatabase } from "@alloy/db"

export async function prepareTestDatabase(name: string): Promise<string> {
  const source = process.env.ALLOY_TEST_DATABASE_URL
  if (!source) throw new Error("ALLOY_TEST_DATABASE_URL is not set")

  const sourceUrl = new URL(source)
  const database = `${databaseName(sourceUrl)}_${name}`
  const maintenanceUrl = new URL(source)
  maintenanceUrl.pathname = "/postgres"

  const client = createPostgresPool(maintenanceUrl.toString(), { max: 1 })
  try {
    await client.query(
      `drop database if exists ${quoteIdentifier(database)} with (force)`,
    )
    await client.query(`create database ${quoteIdentifier(database)}`)
  } finally {
    await client.end()
  }

  const databaseUrl = new URL(source)
  databaseUrl.pathname = `/${database}`
  const url = databaseUrl.toString()

  process.env.NODE_ENV = "test"
  process.env.DATABASE_URL = url
  process.env.ALLOY_VIEWER_COOKIE_SECRET =
    "test-viewer-cookie-secret-000000000000"
  process.env.ALLOY_UPLOAD_HMAC_SECRET = "test-upload-hmac-secret-0000000000000"

  await migrateDatabase(url)
  return url
}

function databaseName(url: URL) {
  const name = decodeURIComponent(url.pathname.slice(1))
  if (!name) throw new Error("ALLOY_TEST_DATABASE_URL must include a database")
  return name
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}
