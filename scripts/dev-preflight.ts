import { runLoggedCommand, writeLine } from "./dev-io.ts"
import type { DevProcess } from "./dev-process.ts"

export const DEFAULT_API_PORT = 2552
export const DEFAULT_WEB_PORT = 5173
export const DEFAULT_ML_PORT = 2662

const DEFAULT_DATABASE_HOST = "127.0.0.1"
const DEFAULT_TRUSTED_ORIGINS = `http://localhost:${DEFAULT_WEB_PORT},http://127.0.0.1:${DEFAULT_WEB_PORT}`

type PostgresConnection = {
  database: string
  host: string
  port: string
  user: string
}

export function getDevEnv(includeMl: boolean): Record<string, string> {
  const apiPort = readPortEnv("PORT", DEFAULT_API_PORT)
  const env: Record<string, string> = {
    DATABASE_URL: Deno.env.get("DATABASE_URL") ?? defaultDatabaseUrl(),
    NODE_ENV: Deno.env.get("NODE_ENV") ?? "development",
    PORT: String(apiPort),
    PUBLIC_SERVER_URL:
      Deno.env.get("PUBLIC_SERVER_URL") ?? `http://localhost:${apiPort}`,
    TRUSTED_ORIGINS: Deno.env.get("TRUSTED_ORIGINS") ?? DEFAULT_TRUSTED_ORIGINS,
  }

  if (includeMl) {
    env.MACHINE_LEARNING_ENABLED =
      Deno.env.get("MACHINE_LEARNING_ENABLED") ?? "1"
    env.MACHINE_LEARNING_URL =
      Deno.env.get("MACHINE_LEARNING_URL") ??
      `http://localhost:${readPortEnv("ALLOY_ML_PORT", DEFAULT_ML_PORT)}`
  }

  return env
}

export async function ensureDevPostgres(databaseUrl: string): Promise<void> {
  const connection = parsePostgresUrl(databaseUrl)
  if (!connection) {
    writeLine(Deno.stderr, "pg", "DATABASE_URL must be a PostgreSQL URL.")
    Deno.exit(1)
  }

  if (!isLocalhost(connection.host)) {
    return
  }

  if (await isPostgresReady(connection)) {
    return
  }

  if (!(await hasLocalPostgresTools())) {
    writeLine(
      Deno.stderr,
      "pg",
      `PostgreSQL is not reachable at ${connection.host}:${connection.port}, and local PostgreSQL tools are missing. Enter the Nix dev shell with 'nix develop'.`
    )
    Deno.exit(1)
  }

  writeLine(Deno.stderr, "pg", "starting local PostgreSQL.")
  await runLoggedCommand("pg", "scripts/dev-postgres.sh", ["start"], {
    env: {
      DATABASE_URL: databaseUrl,
      PGDATABASE: connection.database,
      PGHOST: connection.host,
      PGPORT: connection.port,
      PGUSER: connection.user,
    },
  })
}

export async function assertPortsAvailable(
  processes: DevProcess[]
): Promise<void> {
  if (Deno.env.get("ALLOY_DEV_PORT_CHECK") === "0") {
    return
  }

  const checkedPorts = new Set<number>()
  for (const process of processes) {
    if (process.port === undefined || checkedPorts.has(process.port)) {
      continue
    }

    checkedPorts.add(process.port)
    if (await isPortInUse(process.port)) {
      writeLine(
        Deno.stderr,
        "dev",
        `${process.label} port ${process.port} is already in use; stop that process or set ALLOY_DEV_PORT_CHECK=0 to skip this preflight.`
      )
      Deno.exit(1)
    }
  }
}

function defaultDatabaseUrl(): string {
  const url = new URL("postgres://localhost")
  url.username = Deno.env.get("PGUSER") ?? "postgres"
  url.hostname = Deno.env.get("PGHOST") ?? DEFAULT_DATABASE_HOST
  url.port = Deno.env.get("PGPORT") ?? "5432"
  url.pathname = Deno.env.get("PGDATABASE") ?? "alloy"
  return url.toString()
}

function parsePostgresUrl(value: string): PostgresConnection | null {
  try {
    const url = new URL(value)
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      return null
    }

    return {
      database:
        decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres",
      host: normalizePostgresHost(url.hostname),
      port: url.port || "5432",
      user: decodeURIComponent(url.username || "postgres"),
    }
  } catch {
    return null
  }
}

function isLocalhost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1"
}

function normalizePostgresHost(host: string): string {
  const normalized = host.replace(/^\[(.*)\]$/, "$1")
  return normalized || DEFAULT_DATABASE_HOST
}

export function readPortEnv(name: string, fallback: number): number {
  const raw = Deno.env.get(name)
  if (raw === undefined) {
    return fallback
  }

  if (!/^\d+$/.test(raw)) {
    writeLine(Deno.stderr, "dev", `${name} must be a TCP port number.`)
    Deno.exit(1)
  }

  const port = Number(raw)
  if (port < 1 || port > 65535) {
    writeLine(Deno.stderr, "dev", `${name} must be between 1 and 65535.`)
    Deno.exit(1)
  }

  return port
}

async function isPostgresReady(
  connection: PostgresConnection
): Promise<boolean> {
  if (!(await commandExists("pg_isready"))) {
    return false
  }

  const status = await new Deno.Command("pg_isready", {
    args: [
      "-h",
      connection.host,
      "-p",
      connection.port,
      "-U",
      connection.user,
      "-d",
      connection.database,
    ],
    stdout: "null",
    stderr: "null",
  }).spawn().status

  return status.success
}

async function hasLocalPostgresTools(): Promise<boolean> {
  const required = ["createdb", "initdb", "pg_ctl", "pg_isready", "psql"]
  const results = await Promise.all(required.map(commandExists))
  return results.every(Boolean)
}

async function commandExists(command: string): Promise<boolean> {
  const status = await new Deno.Command("sh", {
    args: ["-c", `command -v "$1" >/dev/null 2>&1`, "sh", command],
    stdout: "null",
    stderr: "null",
  }).spawn().status

  return status.success
}

async function isPortInUse(port: number): Promise<boolean> {
  const hosts = ["127.0.0.1", "0.0.0.0"]
  for (const hostname of hosts) {
    if (!(await canListen(hostname, port))) {
      return true
    }
  }
  return false
}

async function canListen(hostname: string, port: number): Promise<boolean> {
  let listener: Deno.Listener | null = null
  try {
    listener = Deno.listen({
      hostname,
      port,
      transport: "tcp",
    })
    return true
  } catch (err) {
    if (
      err instanceof Deno.errors.AddrInUse ||
      err instanceof Deno.errors.AddrNotAvailable
    ) {
      return false
    }
    throw err
  } finally {
    try {
      listener?.close()
    } catch {
      // The listener may already have closed.
    }
  }
}
