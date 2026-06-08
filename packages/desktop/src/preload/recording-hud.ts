import { contextBridge, ipcRenderer } from "electron"

import type { AlloyRecordingHud, RecordingHudState } from "../shared/ipc"
import { IPC } from "../shared/ipc"

const alloyRecordingHud: AlloyRecordingHud = {
  onState: (listener) => {
    const handler = (_event: unknown, state: RecordingHudState | null) => {
      listener(state)
    }
    ipcRenderer.on(IPC.recordingHudState, handler)
    return () => {
      ipcRenderer.removeListener(IPC.recordingHudState, handler)
    }
  },
}

contextBridge.exposeInMainWorld("alloyRecordingHud", alloyRecordingHud)
