import { EventEmitter } from "node:events"

import type { RuntimeConfig } from "@workspace/contracts"

type ConfigEvent = {
  authConfigChanged: boolean
  steamgriddbStatusChanged: boolean
}

const emitter = new EventEmitter()

const EVENT_NAME = "config"

function oauthProviderKey(config: Readonly<RuntimeConfig>): string {
  return JSON.stringify(config.oauthProvider)
}

export function publishConfigChange(
  next: Readonly<RuntimeConfig>,
  prev: Readonly<RuntimeConfig>
): void {
  const event: ConfigEvent = {
    authConfigChanged:
      next.setupComplete !== prev.setupComplete ||
      next.openRegistrations !== prev.openRegistrations ||
      next.passkeyEnabled !== prev.passkeyEnabled ||
      next.requireAuthToBrowse !== prev.requireAuthToBrowse ||
      oauthProviderKey(next) !== oauthProviderKey(prev),
    steamgriddbStatusChanged:
      Boolean(next.integrations.steamgriddbApiKey) !==
      Boolean(prev.integrations.steamgriddbApiKey),
  }

  if (!event.authConfigChanged && !event.steamgriddbStatusChanged) return
  emitter.emit(EVENT_NAME, event)
}

export function subscribeToConfigChanges(
  listener: (event: ConfigEvent) => void
): () => void {
  emitter.on(EVENT_NAME, listener)
  return () => {
    emitter.off(EVENT_NAME, listener)
  }
}

export type { ConfigEvent }
