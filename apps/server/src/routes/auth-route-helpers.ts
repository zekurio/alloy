import { createMiddleware } from "hono/factory"

import { env } from "../env"
import { configStore } from "../config/store"

export const csrf = createMiddleware(async (c, next) => {
  if (!["POST", "PATCH", "DELETE", "PUT"].includes(c.req.method)) {
    await next()
    return
  }
  const origin = c.req.header("origin")
  if (origin && !env.TRUSTED_ORIGINS.includes(origin)) {
    return c.json({ error: "Forbidden" }, 403)
  }
  await next()
})

export function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}

export async function canOpenPasskeyRegistration(): Promise<boolean> {
  return (
    configStore.get("openRegistrations") && configStore.get("passkeyEnabled")
  )
}
