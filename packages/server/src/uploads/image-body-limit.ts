import type { UploadLimits } from "@alloy/contracts"
import { configStore } from "@alloy/server/config/store"
import type { MiddlewareHandler } from "hono"
import { bodyLimit } from "hono/body-limit"

type ByteLimitKey = Exclude<keyof UploadLimits, "screenshotMaxPixels">

/** Resolve at request time so an admin change takes effect without a restart. */
export function imageBodyLimit(
  key: ByteLimitKey,
  fileCount = 1,
): MiddlewareHandler {
  return (c, next) =>
    bodyLimit({
      maxSize: configStore.get("uploadLimits")[key] * fileCount + 16 * 1024,
    })(c, next)
}
