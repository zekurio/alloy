import { isFiniteNumberValue } from "./object"
import { t } from "./schema"

// Bound memory use even when an administrator raises an upload limit.
export const UPLOAD_MAX_BYTES = 1024 * 1024 * 1024
export const UPLOAD_MAX_PIXELS = 256_000_000

/**
 * A positive safe integer up to `max`. Checked before decoding because the
 * decoder converts numeric strings, which an untrusted boundary must reject.
 */
export function positiveSafeIntegerSchema(max = Number.MAX_SAFE_INTEGER) {
  return t
    .unknown()
    .refine(
      (value) =>
        isFiniteNumberValue(value) &&
        Number.isSafeInteger(value) &&
        value > 0 &&
        value <= max,
      max === Number.MAX_SAFE_INTEGER
        ? "must be a positive safe integer"
        : `must be a positive integer no greater than ${max}`,
    )
    .transform((value) => {
      // SAFETY: The refinement accepts only positive safe integer numbers.
      return value as number
    })
}

const BytesSchema = positiveSafeIntegerSchema(UPLOAD_MAX_BYTES)

export const UploadLimitsSchema = t.object({
  screenshotMaxBytes: BytesSchema.$default(50 * 1024 * 1024),
  screenshotMaxPixels:
    positiveSafeIntegerSchema(UPLOAD_MAX_PIXELS).$default(64_000_000),
  avatarMaxBytes: BytesSchema.$default(5 * 1024 * 1024),
  bannerMaxBytes: BytesSchema.$default(10 * 1024 * 1024),
  gameAssetMaxBytes: BytesSchema.$default(10 * 1024 * 1024),
})

export type UploadLimits = t.infer<typeof UploadLimitsSchema>
export const DEFAULT_UPLOAD_LIMITS: UploadLimits = UploadLimitsSchema.parse({})
