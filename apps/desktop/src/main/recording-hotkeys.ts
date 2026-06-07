import type { RecordingSettings } from "alloy-contracts"
import { logger } from "alloy-logging"
import { globalShortcut } from "electron"

import { saveReplayClip } from "./recording"
import { electronAccelerator } from "./recording-hotkey-accelerator"
import { getRecordingSettings } from "./server-store"

const registeredAccelerators = new Set<string>()

export function configureRecordingHotkeys(
  settings: RecordingSettings = getRecordingSettings(),
): void {
  unregisterRecordingHotkeys()

  const accelerator = electronAccelerator(settings.hotkeys.saveClip)
  if (!accelerator) return

  const registered = globalShortcut.register(
    accelerator,
    () => void runSaveClipHotkey(),
  )
  if (registered) {
    registeredAccelerators.add(accelerator)
  } else {
    logger.warn(`[desktop] failed to register hotkey: ${accelerator}`)
  }
}

export function unregisterRecordingHotkeys(): void {
  for (const accelerator of registeredAccelerators) {
    globalShortcut.unregister(accelerator)
  }
  registeredAccelerators.clear()
}

async function runSaveClipHotkey(): Promise<void> {
  const result = await saveReplayClip()
  if (!result.ok) {
    logger.warn(`[desktop] recording hotkey failed: ${result.error}`)
  }
}
