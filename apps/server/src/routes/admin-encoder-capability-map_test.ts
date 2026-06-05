import { test } from "node:test"

import {
  emptyEncoderAvailability,
  encoderAvailabilityFromNames,
  encoderAvailabilityFromProbe,
} from "./admin-encoder-capability-map"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

test("encoderAvailabilityFromNames maps software encoder names", () => {
  const available = encoderAvailabilityFromNames(
    new Set(["libx264", "libx265", "libsvtav1"]),
  )

  assert(available.none.h264, "software H.264 should be available")
  assert(available.none.hevc, "software HEVC should be available")
  assert(available.none.av1, "software AV1 should be available")
  assert(!available.nvenc.h264, "NVENC should remain unavailable")
})

test("encoderAvailabilityFromNames maps hardware backend encoder names", () => {
  const available = encoderAvailabilityFromNames(
    new Set(["h264_qsv", "hevc_qsv", "av1_nvenc"]),
  )

  assert(available.qsv.h264, "QSV H.264 should be available")
  assert(available.qsv.hevc, "QSV HEVC should be available")
  assert(!available.qsv.av1, "QSV AV1 should remain unavailable")
  assert(available.nvenc.av1, "NVENC AV1 should be available")
})

test("emptyEncoderAvailability reports every backend unavailable", () => {
  const available = emptyEncoderAvailability()

  for (const codecs of Object.values(available)) {
    assert(!codecs.h264, "H.264 should be unavailable")
    assert(!codecs.hevc, "HEVC should be unavailable")
    assert(!codecs.av1, "AV1 should be unavailable")
  }
})

test("encoderAvailabilityFromProbe requires QSV hwaccel", () => {
  const withoutHwaccel = encoderAvailabilityFromProbe({
    encoders: new Set(["h264_qsv"]),
    filters: new Set(),
    hwaccels: new Set(),
  })
  const withHwaccel = encoderAvailabilityFromProbe({
    encoders: new Set(["h264_qsv"]),
    filters: new Set(),
    hwaccels: new Set(["qsv"]),
  })

  assert(!withoutHwaccel.qsv.h264, "QSV should require qsv hwaccel")
  assert(withHwaccel.qsv.h264, "QSV H.264 should be available with hwaccel")
})

test("encoderAvailabilityFromProbe requires VAAPI hwaccels and filters", () => {
  const encoders = new Set(["hevc_vaapi"])
  const filters = new Set(["hwupload_vaapi"])

  const withoutFilters = encoderAvailabilityFromProbe({
    encoders,
    filters: new Set(),
    hwaccels: new Set(["drm", "vaapi"]),
  })
  const withUsedFilter = encoderAvailabilityFromProbe({
    encoders,
    filters,
    hwaccels: new Set(["drm", "vaapi"]),
  })

  assert(!withoutFilters.vaapi.hevc, "VAAPI should require hwupload_vaapi")
  assert(
    withUsedFilter.vaapi.hevc,
    "VAAPI HEVC should not require unused VAAPI filters",
  )
})

test("encoderAvailabilityFromProbe gates NVENC and RKMPP support", () => {
  const available = encoderAvailabilityFromProbe({
    encoders: new Set(["av1_nvenc", "h264_rkmpp"]),
    filters: new Set(["scale_rkrga", "vpp_rkrga", "overlay_rkrga"]),
    hwaccels: new Set(["cuda", "rkmpp"]),
  })
  const missingFilters = encoderAvailabilityFromProbe({
    encoders: new Set(["av1_nvenc", "h264_rkmpp"]),
    filters: new Set(),
    hwaccels: new Set(["cuda", "rkmpp"]),
  })

  assert(available.nvenc.av1, "NVENC AV1 should be available")
  assert(available.rkmpp.h264, "RKMPP H.264 should be available")
  assert(
    missingFilters.nvenc.av1,
    "NVENC should not require unused CUDA upload filter",
  )
  assert(!missingFilters.rkmpp.h264, "RKMPP should require RKRGA filters")
})

test("encoderAvailabilityFromProbe does not require unused VideoToolbox filters", () => {
  const withoutFilters = encoderAvailabilityFromProbe({
    encoders: new Set(["h264_videotoolbox"]),
    filters: new Set(),
    hwaccels: new Set(["videotoolbox"]),
  })
  const withoutHwaccel = encoderAvailabilityFromProbe({
    encoders: new Set(["h264_videotoolbox"]),
    filters: new Set([
      "yadif_videotoolbox",
      "overlay_videotoolbox",
      "tonemap_videotoolbox",
      "scale_vt",
    ]),
    hwaccels: new Set(),
  })

  assert(
    withoutFilters.videotoolbox.h264,
    "VideoToolbox should not require unused filters",
  )
  assert(
    !withoutHwaccel.videotoolbox.h264,
    "VideoToolbox should still require videotoolbox hwaccel",
  )
})
