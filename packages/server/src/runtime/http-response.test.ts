import { logger } from "@alloy/logging"
import { DrizzleQueryError } from "drizzle-orm"
import { Hono } from "hono"
import { expect, test, vi } from "vite-plus/test"

import { badRequestFromCause } from "./http-response"

test("database failures return a safe auth error and log the cause", async () => {
  const cause = new DrizzleQueryError(
    "insert into auth_challenge",
    ["private-challenge"],
    new Error("connection lost"),
  )
  const log = vi.spyOn(logger, "error").mockImplementation(() => {})
  try {
    const app = new Hono().get("/", (c) =>
      badRequestFromCause(c, cause, "Could not start sign-in."),
    )
    const response = await app.request("/")
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: "Could not start sign-in." })
    expect(log).toHaveBeenCalledWith("Database request failed", cause)
  } finally {
    log.mockRestore()
  }
})
