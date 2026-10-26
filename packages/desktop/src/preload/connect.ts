import { contextBridge, ipcRenderer } from "electron"

import {
  CONNECT_CHANNEL,
  type AlloyConnectApi,
  type ConnectCommand,
  type IpcResult,
  type NativeJson,
} from "../shared/ipc"

// The bundled connect screen's API. The main process checks that the sender
// is the connect window showing the bundled page.

async function command(
  name: ConnectCommand,
  url?: string,
): Promise<NativeJson | undefined> {
  const result: IpcResult = await ipcRenderer.invoke(CONNECT_CHANNEL, name, url)
  if (!result.ok) throw new Error(result.error)
  return result.value
}

const api: AlloyConnectApi = {
  connectServer: (url) => command("connectServer", url),
  connectReady: () => command("connectReady"),
  cancelConnect: () => command("cancelConnect"),
  savedServers: () => command("savedServers"),
  forgetServer: (url) => command("forgetServer", url),
}

contextBridge.exposeInMainWorld("alloyConnect", api)
