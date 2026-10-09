import { isFiniteNumberValue } from "./object"
import { t } from "./schema"

// Bound memory use even when an administrator raises an upload limit.
export const UPLOAD_MAX_BYTES = 1024 * 1024 * 1024
export const UPLOAD_MAX_PIXELS = 256_000_000

function limitSchema(max: number) {
  return t
    .unknown()
    .refine(
      (value) =>
        isFiniteNumberValue(value) &&
        Number.isSafeInteger(value) &&
        value > 0 &&
        value <= max,
      `must be a positive integer no greater than ${max}`,
    )
    .transform((value) => {
      // SAFETY: The refinement accepts only positive safe integer numbers.
      return value as number
    })
}

const BytesSchema = limitSchema(UPLOAD_MAX_BYTES)

export const UploadLimitsSchema = t.object({
  screenshotMaxBytes: BytesSchema.$default(50 * 1024 * 1024),
  screenshotMaxPixels: limitSchema(UPLOAD_MAX_PIXELS).$default(64_000_000),
  avatarMaxBytes: BytesSchema.$default(5 * 1024 * 1024),
  bannerMaxBytes: BytesSchema.$default(10 * 1024 * 1024),
  gameAssetMaxBytes: BytesSchema.$default(10 * 1024 * 1024),
  oauthProviderIconMaxBytes: BytesSchema.$default(2 * 1024 * 1024),
})

export type UploadLimits = t.infer<typeof UploadLimitsSchema>
export const DEFAULT_UPLOAD_LIMITS: UploadLimits = UploadLimitsSchema.parse({})
