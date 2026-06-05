import { isOpenGraphCompatibleSource } from "./opengraph"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

Deno.test("isOpenGraphCompatibleSource accepts MP4 H.264 AAC sources", () => {
  assert(
    isOpenGraphCompatibleSource({
      sourceContentType: "video/mp4",
      sourceVideoCodec: "h264",
      sourceAudioCodec: "aac",
    }),
    "MP4 H.264 AAC should be OpenGraph-compatible",
  )
})

Deno.test("isOpenGraphCompatibleSource accepts silent MP4 H.264 sources", () => {
  assert(
    isOpenGraphCompatibleSource({
      sourceContentType: "video/mp4",
      sourceVideoCodec: "avc1",
      sourceAudioCodec: null,
    }),
    "silent MP4 AVC should be OpenGraph-compatible",
  )
})

Deno.test("isOpenGraphCompatibleSource rejects incompatible containers and codecs", () => {
  assert(
    !isOpenGraphCompatibleSource({
      sourceContentType: "video/x-matroska",
      sourceVideoCodec: "h264",
      sourceAudioCodec: "aac",
    }),
    "Matroska source should not be OpenGraph-compatible",
  )
  assert(
    !isOpenGraphCompatibleSource({
      sourceContentType: "video/mp4",
      sourceVideoCodec: "hevc",
      sourceAudioCodec: "aac",
    }),
    "HEVC source should not be OpenGraph-compatible",
  )
  assert(
    !isOpenGraphCompatibleSource({
      sourceContentType: "video/mp4",
      sourceVideoCodec: "h264",
      sourceAudioCodec: "opus",
    }),
    "Opus audio should not be OpenGraph-compatible",
  )
})
