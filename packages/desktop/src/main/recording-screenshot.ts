import { randomUUID } from "node:crypto"
import { mkdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type {
  RecordingActionResult,
  RecordingActionRequest,
  RecordingDisplay,
  RecordingSettings,
  RecordingStatus,
} from "alloy-contracts"
import { desktopCapturer, screen } from "electron"

import { defaultScreenshotFolder } from "./recording-storage"

export async function takeRecordingScreenshot({
  displays,
  request,
  settings,
  status,
}: {
  displays: RecordingDisplay[]
  request: RecordingActionRequest
  settings: RecordingSettings
  status: RecordingStatus
}): Promise<RecordingActionResult> {
  if (!status.replayActive && !status.longRecordingActive) {
    return { ok: true, status }
  }

  const source = await screenshotSource(settings, status, displays)
  if (!source || source.thumbnail.isEmpty()) {
    return {
      ok: false,
      status,
      error: "No active capture source is available for screenshots.",
    }
  }

  const context =
    settings.captureMode === "display"
      ? "Desktop"
      : (status.activeGameDetail?.name ?? "Desktop")
  const directory = join(
    defaultScreenshotFolder(),
    "Screenshots",
    safePathComponent(context, "Desktop"),
  )
  mkdirSync(directory, { recursive: true })
  const filename = join(directory, `${timestampSlug()}-${randomUUID()}.png`)
  writeFileSync(filename, source.thumbnail.toPNG())

  const size = source.thumbnail.getSize()
  const capture = {
    id: randomUUID(),
    filename,
    contentType: "image/png" as const,
    sizeBytes: statSync(filename).size,
    durationMs: null,
    width: size.width,
    height: size.height,
    game: settings.captureMode === "display" ? null : status.activeGameDetail,
    source: settings.captureMode,
    kind: "screenshot" as const,
    chapterStatus: "none" as const,
    chapterError: null,
    createdAt: new Date(request.requestedAtUnixMs).toISOString(),
  }

  return {
    ok: true,
    status: {
      ...status,
      currentCapture: capture,
      currentSource: capture.source,
    },
    capture,
  }
}

async function screenshotSource(
  settings: RecordingSettings,
  status: RecordingStatus,
  displays: RecordingDisplay[],
) {
  const thumbnailSize = { width: 3840, height: 2160 }

  if (settings.captureMode === "display") {
    const selected =
      displays.find((display) => display.id === settings.selectedDisplayId) ??
      displays.find((display) => display.primary) ??
      displays[0]
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      fetchWindowIcons: false,
      thumbnailSize,
    })
    return (
      sources.find(
        (source) =>
          selected?.electronId && source.display_id === selected.electronId,
      ) ?? sources[0]
    )
  }

  const game = status.activeGameDetail
  const sources = await desktopCapturer.getSources({
    types: ["window", "screen"],
    fetchWindowIcons: false,
    thumbnailSize,
  })
  const windowTitle = game?.windowTitle?.trim().toLowerCase()
  const gameName = game?.name.trim().toLowerCase()
  const windowSource = sources.find((source) => {
    if (!source.name) return false
    const name = source.name.toLowerCase()
    return Boolean(
      (windowTitle && name.includes(windowTitle)) ||
      (gameName && name.includes(gameName)),
    )
  })
  if (windowSource) return windowSource

  const primaryDisplayId = String(screen.getPrimaryDisplay().id)
  return (
    sources.find((source) => source.display_id === primaryDisplayId) ??
    sources.find((source) => source.display_id) ??
    sources[0]
  )
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

function safePathComponent(value: string, fallback: string): string {
  const cleaned = replaceControlCharacters(value.trim())
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/[.\s-]+$/g, "")
    .replace(/^[.\s-]+/g, "")
  return cleaned || fallback
}

function replaceControlCharacters(value: string): string {
  let cleaned = ""
  for (const char of value) {
    cleaned += char.charCodeAt(0) <= 0x1f ? "-" : char
  }
  return cleaned
}
