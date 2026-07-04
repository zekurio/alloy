import { t } from "@alloy/i18n"

import { formatMediaDurationMs } from "@/lib/media-time"
import { requireObjectUrl, revokeObjectUrl } from "@/lib/object-url"
import { formatBytes } from "@/lib/storage-format"
import { teardownVideoElement } from "@/lib/video-events"

import type { SelectedFile } from "./new-clip-helpers"

const VIDEO_LOAD_TIMEOUT_MS = 15000

type VideoSession = {
  video: HTMLVideoElement
  cleanup: () => void
}

export type ProbedFile = Omit<SelectedFile, "contentType">

export function probeFile(file: File): Promise<ProbedFile> {
  return new Promise<ProbedFile>((resolve, reject) => {
    const { video, cleanup: cleanupVideo } = createVideoSession(
      file,
      "metadata",
    )
    let settled = false
    let timeoutId = 0
    const cleanup = () => {
      window.clearTimeout(timeoutId)
      cleanupVideo()
    }

    const fail = (message: string) => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(message))
    }

    video.onloadedmetadata = () => {
      if (settled) return
      settled = true
      const width = video.videoWidth
      const height = video.videoHeight
      const durationMs = Math.round((video.duration || 0) * 1000)
      cleanup()
      if (!width || !height || !durationMs) {
        reject(new Error(t("Could not read video metadata")))
        return
      }
      resolve({
        file,
        name: file.name,
        size: formatBytes(file.size),
        resolution: `${width}×${height}`,
        fps: "—FPS",
        duration: formatMediaDurationMs(durationMs),
        durationMs,
        width,
        height,
        sizeBytes: file.size,
      })
    }
    video.onerror = () => {
      fail(videoErrorMessage(video, t("Could not read video metadata")))
    }
    timeoutId = window.setTimeout(() => {
      fail(t("Timed out while reading video metadata"))
    }, VIDEO_LOAD_TIMEOUT_MS)
    video.load()
  })
}

function createVideoSession(
  file: File,
  preload: HTMLVideoElement["preload"],
): VideoSession {
  const url = requireObjectUrl(file, "video file URL")
  const video = document.createElement("video")
  video.preload = preload
  video.muted = true
  video.playsInline = true
  video.src = url

  return {
    video,
    cleanup: () => {
      revokeObjectUrl(url, "video file URL")
      teardownVideoElement(video)
    },
  }
}

function videoErrorMessage(video: HTMLVideoElement, fallback: string): string {
  const message = video.error?.message
  return message ? t("{fallback}: {message}", { fallback, message }) : fallback
}
