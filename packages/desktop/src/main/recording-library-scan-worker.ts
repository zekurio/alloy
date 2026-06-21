import { parentPort } from "node:worker_threads"

import { t } from "@alloy/i18n"

import {
  createRecordingLibrarySnapshot,
  type RecordingLibraryScanWorkerRequest,
  type RecordingLibraryScanWorkerResponse,
} from "./recording-library-scan-core"

if (!parentPort) {
  throw new Error("Recording library scan worker requires a parent port.")
}

parentPort.on("message", (message: RecordingLibraryScanWorkerRequest) => {
  const id = message.id
  let response: RecordingLibraryScanWorkerResponse

  try {
    response = {
      id,
      ok: true,
      snapshot: createRecordingLibrarySnapshot(message.input),
    }
  } catch (cause) {
    response = {
      id,
      ok: false,
      error:
        cause instanceof Error
          ? cause.message
          : t("Recording library scan failed."),
    }
  }

  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Node worker_threads postMessage does not take a targetOrigin.
  parentPort?.postMessage(response)
})
