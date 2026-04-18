import { Hono } from "hono"

import { isSetupRequired } from "../lib/user-bootstrap"

/**
 * Status signal for the first-run setup screen. The bootstrap itself runs
 * through better-auth's `POST /api/auth/sign-up/email` — the user-create
 * hook in `auth.ts` promotes the first caller to admin.
 */
export const setupRoute = new Hono().get("/status", async (c) => {
  return c.json({ setupRequired: await isSetupRequired() })
})
