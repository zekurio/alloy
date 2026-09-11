import { logger } from "@alloy/logging"
import { expect, test, vi } from "vite-plus/test"

import { createPostgresPool } from "./connection"

test("idle connection failures are logged without crashing the process", async () => {
  const log = vi.spyOn(logger, "error").mockImplementation(() => {})
  const pool = createPostgresPool("postgres://localhost/unused")
  const error = new Error("Connection terminated unexpectedly")
  try {
    expect(() => pool.emit("error", error)).not.toThrow()
    expect(log).toHaveBeenCalledWith("[db] Idle connection failed", error)
  } finally {
    await pool.end()
    log.mockRestore()
  }
})
