import { connect } from "node:net"
import { dirname, join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"

export const root = dirname(dirname(fileURLToPath(import.meta.url)))
export const dataDir = join(root, "data")

export function buildDevEnv() {
  const env = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV ?? "development",
    PORT: process.env.PORT ?? "2552",
    PUBLIC_SERVER_URL: process.env.PUBLIC_SERVER_URL ?? "http://localhost:2552",
    TRUSTED_ORIGINS:
      process.env.TRUSTED_ORIGINS ??
      "http://localhost:5173,http://127.0.0.1:5173",
    ALLOY_DATA_DIR: process.env.ALLOY_DATA_DIR ?? dataDir,
    ALLOY_CLIPS_DIR: process.env.ALLOY_CLIPS_DIR ?? join(dataDir, "clips"),
    ALLOY_ENCODE_DIR: process.env.ALLOY_ENCODE_DIR ?? join(dataDir, "encode"),
  }

  env.DATABASE_URL = process.env.DATABASE_URL ?? localDatabaseUrl("5432")
  env.DRIZZLE_DATABASE_URL =
    process.env.DRIZZLE_DATABASE_URL ?? env.DATABASE_URL

  return env
}

export function localDatabaseUrl(port) {
  const url = new URL("postgres://127.0.0.1")
  url.username = process.env.ALLOY_DEV_DATABASE_USER ?? "postgres"
  url.password = process.env.ALLOY_DEV_DATABASE_PASSWORD ?? "postgres"
  url.port = port
  url.pathname = "/alloy"
  return url.toString()
}

export async function waitForDatabase(databaseUrl) {
  const endpoint = databaseEndpoint(databaseUrl)
  if (!endpoint) return

  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (await canConnect(endpoint)) return
    await sleep(500)
  }

  throw new Error(
    `Could not connect to Postgres at ${endpoint.host}:${endpoint.port}. Start Docker Postgres or enter devenv before running database-backed dev commands.`,
  )
}

function databaseEndpoint(databaseUrl) {
  let url
  try {
    url = new URL(databaseUrl)
  } catch {
    return undefined
  }

  const socketHost = url.searchParams.get("host")
  if (socketHost?.startsWith("/")) return undefined

  return {
    host: url.hostname || socketHost || "127.0.0.1",
    port: Number(url.port || 5432),
  }
}

function canConnect(endpoint) {
  return new Promise((resolve) => {
    const socket = connect(endpoint)
    socket.setTimeout(1000)
    socket.once("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.once("error", () => resolve(false))
    socket.once("timeout", () => {
      socket.destroy()
      resolve(false)
    })
  })
}
