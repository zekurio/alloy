import type { SetupStatus } from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import { usableOidcProvider } from "@alloy/server/auth/oauth-config"
import {
  hasSetupAccess,
  setupMode,
  setupRequired,
  verifySetupToken,
} from "@alloy/server/auth/setup"
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

function setupStatus(c: Context, access = hasSetupAccess(c)): SetupStatus {
  const mode = setupRequired() ? setupMode() : null
  return {
    mode,
    roleClaim:
      mode === "oidc" ? (usableOidcProvider()?.roleClaim ?? null) : null,
    tokenRequired: mode === "passkey" && !access,
  }
}

export const setupRoute = new Hono()
  .get("/status", (c) => c.json(setupStatus(c)))
  .post("/verify", verifyRateLimit, tbValidator("json", VerifyBody), (c) => {
    if (!setupRequired()) return conflict(c, "Setup is already complete.")
    if (!verifySetupToken(c, c.req.valid("json").token)) {
      return badRequest(c, "That setup token is not valid.")
    }
    // The access cookie rides on this response, not on the request.
    return c.json(setupStatus(c, true))
  })
