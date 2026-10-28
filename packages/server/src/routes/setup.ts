import type { SetupStatus } from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import {
  hasSetupAccess,
  verifySetupToken,
} from "@alloy/server/auth/setup-token"
import { getSetupStatus } from "@alloy/server/auth/user-bootstrap"
import { badRequest, conflict } from "@alloy/server/runtime/http-response"
import { rateLimiter } from "@alloy/server/runtime/rate-limit"
import { requestIp } from "@alloy/server/runtime/request-ip"
import { type Context, Hono } from "hono"

import { requiredTrimmedString, tbValidator } from "./validation"

const VerifyBody = t.object({ token: requiredTrimmedString() })

// Guessing the token is the only way to the admin account.
const verifyRateLimit = rateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  key: requestIp,
})

async function setupStatus(c: Context): Promise<SetupStatus> {
  const status = await getSetupStatus()
  return {
    ...status,
    tokenRequired: status.adminAccountRequired && !hasSetupAccess(c),
  }
}

export const setupRoute = new Hono()
  .get("/status", async (c) => c.json(await setupStatus(c)))
  .post(
    "/verify",
    verifyRateLimit,
    tbValidator("json", VerifyBody),
    async (c) => {
      const { adminAccountRequired } = await getSetupStatus()
      if (!adminAccountRequired) {
        return conflict(c, "Setup is already complete.")
      }
      if (!verifySetupToken(c, c.req.valid("json").token)) {
        return badRequest(c, "That setup token is not valid.")
      }
      // The access cookie rides on this response, not on the request.
      const status: SetupStatus = {
        ...(await getSetupStatus()),
        tokenRequired: false,
      }
      return c.json(status)
    },
  )
