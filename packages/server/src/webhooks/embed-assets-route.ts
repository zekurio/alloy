import { Hono } from "hono"

import { WEBHOOK_LOGO_PNG, WEBHOOK_TEST_THUMBNAIL_JPEG } from "./embed-assets"

// Embedded, immutable binaries; Discord's media proxy must be able to fetch
// them without auth, and they must exist independent of the web build.
const CACHE_CONTROL = "public, max-age=86400, immutable"

export const webhookEmbedAssetsRoute = new Hono()
  .get("/logo.png", (c) => {
    c.header("Cache-Control", CACHE_CONTROL)
    c.header("Content-Type", "image/png")
    return c.body(new Uint8Array(WEBHOOK_LOGO_PNG))
  })
  .get("/test-thumbnail.jpg", (c) => {
    c.header("Cache-Control", CACHE_CONTROL)
    c.header("Content-Type", "image/jpeg")
    return c.body(new Uint8Array(WEBHOOK_TEST_THUMBNAIL_JPEG))
  })
