import { SCREENSHOT_MAX_BYTES, SCREENSHOT_MAX_PIXELS } from "@alloy/contracts"
import sharp from "sharp"

import { imageBlurHashFromBytes } from "./blurhash"

/** Decode before publishing; headers and client dimensions are only hints. */
export async function prepareScreenshot(bytes: Buffer, contentType: string) {
  if (bytes.length > SCREENSHOT_MAX_BYTES)
    throw new Error("Screenshot exceeds 50 MiB")
  const image = sharp(bytes, {
    limitInputPixels: SCREENSHOT_MAX_PIXELS,
    failOn: "warning",
  })
  const metadata = await image.metadata()
  const expected = {
    "image/jpeg": "jpeg",
    "image/png": "png",
    "image/webp": "webp",
  }
  if (
    !Object.entries(expected).some(
      ([mime, format]) => mime === contentType && format === metadata.format,
    )
  ) {
    throw new Error("Image content type did not match bytes")
  }
  if ((metadata.pages ?? 1) !== 1)
    throw new Error("Animated images are not supported")
  const source = await image
    .rotate()
    .png()
    .toBuffer({ resolveWithObject: true })
  if (source.data.length > SCREENSHOT_MAX_BYTES)
    throw new Error("Processed screenshot exceeds 50 MiB")
  const thumbnail = await sharp(source.data)
    .resize({
      width: 960,
      height: 960,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#111111" })
    .jpeg({ quality: 85 })
    .toBuffer()
  return {
    bytes: source.data,
    width: source.info.width,
    height: source.info.height,
    thumbnail,
    blurHash: await imageBlurHashFromBytes(thumbnail),
  }
}
