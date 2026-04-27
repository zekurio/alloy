import * as React from "react"
import { useRouter } from "@tanstack/react-router"

import { invalidateAuthConfig } from "./session-suspense"

type RuntimeConfigEvent = {
  authConfigChanged?: boolean
}

type RuntimeConfigListener = (event: RuntimeConfigEvent) => void

const listeners = new Set<RuntimeConfigListener>()

export function publishRuntimeConfigUpdate(event: RuntimeConfigEvent): void {
  if (event.authConfigChanged) {
    invalidateAuthConfig()
  }
  for (const listener of listeners) {
    listener(event)
  }
}

function subscribeRuntimeConfigUpdates(
  listener: RuntimeConfigListener
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function RuntimeConfigEvents() {
  const router = useRouter()

  React.useEffect(
    () =>
      subscribeRuntimeConfigUpdates((event) => {
        if (event.authConfigChanged) void router.invalidate()
      }),
    [router]
  )

  return null
}
