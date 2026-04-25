import { createServerFn } from "@tanstack/react-start"
import { getRequestHeaders } from "@tanstack/react-start/server"

import { apiOrigin } from "./env"
import type { Session } from "./session-suspense"

type SessionData = Session | null

export const fetchCurrentServerSession = createServerFn({
  method: "GET",
}).handler(async (): Promise<SessionData> => {
  try {
    const cookie = getRequestHeaders().get("cookie") ?? null
    const response = await fetch(
      new URL("/api/auth/get-session", apiOrigin()),
      {
        headers: cookie ? { cookie } : undefined,
      }
    )

    if (!response.ok) return null

    return (await response.json()) as SessionData
  } catch {
    return null
  }
})
